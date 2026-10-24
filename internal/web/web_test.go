package web

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testStatic(t *testing.T) *Static {
	t.Helper()
	dir := t.TempDir()
	for file, data := range map[string]string{"index.html": "<html>shell</html>", "_redirects": "/old/* /zh/:splat 301\n/ /zh/ 301\n", "assets/app-abc.js": "const answer = 42", "folder/index.html": "directory", ".secret": "private"} {
		p := filepath.Join(dir, file)
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(outside, []byte("outside secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "leak")); err != nil {
		t.Fatal(err)
	}
	s, err := NewStatic(dir, func(p string) bool { return p == "/zh/" })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Root.Close() })
	return s
}

func TestStatic(t *testing.T) {
	s := testStatic(t)
	for _, test := range []struct {
		url    string
		status int
		body   string
	}{
		{"/zh/", 200, "shell"}, {"/folder", 200, "directory"}, {"/folder/", 200, "directory"},
		{"/missing.js", 404, "404"}, {"/.secret", 404, "404"}, {"/a/../.secret", 404, "404"},
		{"/leak", 404, "404"}, {"/_redirects", 404, "404"},
	} {
		t.Run(test.url, func(t *testing.T) {
			w := httptest.NewRecorder()
			s.ServeHTTP(w, httptest.NewRequest("GET", test.url, nil))
			if w.Code != test.status || !strings.Contains(w.Body.String(), test.body) {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "secret") {
				t.Fatal("secret leaked")
			}
		})
	}
}

func TestStaticHTTP(t *testing.T) {
	s := testStatic(t)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("HEAD", "/assets/app-abc.js", nil))
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("ETag") == "" {
		t.Fatalf("HEAD: %v", w)
	}
	r := httptest.NewRequest("GET", "/assets/app-abc.js", nil)
	r.Header.Set("If-None-Match", w.Header().Get("ETag"))
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 304 {
		t.Fatalf("conditional: %d", w.Code)
	}
	r = httptest.NewRequest("GET", "/assets/app-abc.js", nil)
	r.Header.Set("Range", "bytes=0-4")
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "const" {
		t.Fatalf("range: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/zh/", nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}

func TestRedirects(t *testing.T) {
	s := testStatic(t)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/old/中文/?q=a%20b", nil))
	if w.Code != 301 || w.Header().Get("Location") != "/zh/%E4%B8%AD%E6%96%87/?q=a%20b" {
		t.Fatalf("%d %s", w.Code, w.Header().Get("Location"))
	}
}

func TestSearch(t *testing.T) {
	documents := []SearchDocument{
		{URL: "/zh/正文/", Locale: "zh", Title: "正文命中", Text: "前文 <script>alert(1)</script> 中文正文和😀字符"},
		{URL: "/zh/标题/", Locale: "zh", Title: "中文标题", Text: "其他文本"},
		{URL: "/en/post/", Locale: "en", Title: "中文", Text: "中文"},
	}
	w := httptest.NewRecorder()
	Search(w, httptest.NewRequest("GET", "/api/search?q=中文&locale=zh&limit=2", nil), documents)
	var response struct {
		Results []SearchResult `json:"results"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 2 || response.Results[0].URL != "/zh/标题/" || !strings.Contains(response.Results[1].Excerpt, "😀") {
		t.Fatalf("%+v", response)
	}
	if strings.Contains(w.Body.String(), "<script>") {
		t.Fatal("JSON HTML escaping disabled")
	}
	for _, query := range []string{"q=&locale=zh", "q=x&locale=fr", "q=x&locale=zh&limit=0", "q=x&locale=zh&limit=51", "q=x&locale=zh&limit=no", "q=x&locale=zh&q=y", "q=x&locale=zh&unknown=1", "q=%FF&locale=zh"} {
		w := httptest.NewRecorder()
		Search(w, httptest.NewRequest("GET", "/api/search?"+query, nil), documents)
		if w.Code != 400 {
			t.Errorf("%s: %d", query, w.Code)
		}
	}
}

func TestCorpus(t *testing.T) {
	for _, value := range []string{`{}`, `{"version":2,"documents":[]}`, `{"version":1,"documents":null}`, `{"version":1,"documents":[],"extra":1}`, `{"version":1,"documents":[]} {}`, `{"version":1,"documents":[{"url":"https://evil.test","locale":"zh","title":"bad","text":"text"}]}`} {
		if _, err := ReadCorpus(strings.NewReader(value)); err == nil {
			t.Errorf("accepted %s", value)
		}
	}
	if _, err := ReadCorpus(strings.NewReader(`{"version":1,"documents":[]}`)); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyImageURLWebP(t *testing.T) {
	s := testStatic(t)
	if err := s.Root.MkdirAll("static/images", 0755); err != nil {
		t.Fatal(err)
	}
	if err := s.Root.WriteFile("static/images/chart.webp", []byte("RIFFwebp-content"), 0644); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.redirects = append(s.redirects, redirect{"/static/images/chart.png", "/static/images/chart.webp", 301})
	s.ServeHTTP(w, httptest.NewRequest("GET", "/static/images/chart.png", nil))
	if w.Code != 301 || w.Header().Get("Location") != "/static/images/chart.webp" {
		t.Fatalf("legacy image: %d %v", w.Code, w.Header())
	}
	r := httptest.NewRequest("GET", "/static/images/chart.webp", nil)
	r.Header.Set("Range", "bytes=0-3")
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "RIFF" {
		t.Fatal("alias Range failed")
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("HEAD", "/static/images/chart.webp", nil))
	if w.Code != 200 || w.Body.Len() != 0 {
		t.Fatal("alias HEAD failed")
	}
	if err := s.Root.Symlink("../../index.html", "static/images/link.webp"); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/static/images/link.webp", nil))
	if w.Code != 404 {
		t.Fatal("alias symlink must be denied")
	}
}
