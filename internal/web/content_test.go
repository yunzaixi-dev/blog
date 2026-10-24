package web

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContentByteSnapshots(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "article.md")
	builds := 0
	store := ContentStore{Directory: dir, Build: func(files []ContentFile) (*Snapshot, error) {
		builds++
		if len(files) > 0 && files[0].Data == "bad!" {
			return nil, fmt.Errorf("invalid content")
		}
		return &Snapshot{Pages: map[string]json.RawMessage{}}, nil
	}}
	if err := os.WriteFile(file, []byte("old!"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(file)
	if err := os.WriteFile(file, []byte("new!"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(file, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if builds != 2 {
		t.Fatal("same-size same-time edit was missed")
	}
	if err := os.WriteFile(file, []byte("bad!"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("served stale snapshot")
	}
	if err := os.WriteFile(file, []byte("good"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if len(store.files) != 0 {
		t.Fatal("delete not reflected")
	}
}

func TestRuntimeHTTPContract(t *testing.T) {
	static := testStatic(t)
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "post.md"), []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	page := json.RawMessage(`{"locale":"zh","kind":"home","metadata":{"title":"API-only","description":"safe","canonical":"https://zaixi.dev/zh/","languages":{},"jsonLd":{"description":"</script>safe"}}}`)
	notFound := json.RawMessage(`{"locale":"en","kind":"notFound","metadata":{"title":"Not found","languages":{}}}`)
	store := &ContentStore{Directory: directory, Build: func([]ContentFile) (*Snapshot, error) {
		return &Snapshot{Pages: map[string]json.RawMessage{"/zh/": page, "/zh/404/": page, "/en/404/": notFound}, Documents: []SearchDocument{}, Locales: map[string]string{"zh": "zh-CN", "en": "en-US"}}, nil
	}}
	h := &Handler{Content: store, Static: static}
	static.Shell = h.Shell
	for _, test := range []struct {
		url      string
		status   int
		contains string
	}{
		{"/api/page?path=/zh/", 200, "API-only"},
		{"/api/page?path=/en/missing/", 404, "notFound"},
		{"/api/page?path=/zh/&path=/en/", 400, "invalid"},
		{"/api/page?path=/.secret", 400, "invalid"},
		{"/api/unknown", 404, "not found"},
		{"/missing.js", 404, "404"},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", test.url, nil))
		if w.Code != test.status || !strings.Contains(w.Body.String(), test.contains) {
			t.Errorf("%s: %d %s", test.url, w.Code, w.Body.String())
		}
	}
	store.Build = func([]ContentFile) (*Snapshot, error) { return nil, fmt.Errorf("invalid") }
	if err := os.WriteFile(filepath.Join(directory, "post.md"), []byte("broken"), 0644); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/page?path=/zh/", nil))
	if w.Code != 503 {
		t.Fatal("invalid content must not serve stale or 404")
	}
}
