package web

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type ContentFile struct {
	Path string `json:"path"`
	Data string `json:"data"`
}
type Metadata struct {
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Canonical   string            `json:"canonical"`
	Languages   map[string]string `json:"languages"`
	Image       string            `json:"image"`
	Type        string            `json:"type"`
	Published   string            `json:"published"`
	Modified    string            `json:"modified"`
	JSONLD      json.RawMessage   `json:"jsonLd"`
}
type Page struct {
	Locale   string   `json:"locale"`
	Kind     string   `json:"kind"`
	Metadata Metadata `json:"metadata"`
}
type Snapshot struct {
	Redirects string                     `json:"redirects,omitempty"`
	Version   int                        `json:"version"`
	Pages     map[string]json.RawMessage `json:"pages"`
	Documents []SearchDocument           `json:"documents"`
	Exports   map[string]string          `json:"exports"`
	Feeds     map[string]string          `json:"feeds"`
	Sitemap   string                     `json:"sitemap"`
	Robots    string                     `json:"robots"`
	Locales   map[string]string          `json:"locales"`
}

type Worker struct {
	cmd *exec.Cmd
	in  io.WriteCloser
	out *bufio.Reader
	mu  sync.Mutex
}

func StartWorker(ctx context.Context, executable, script string) (*Worker, error) {
	cmd := exec.CommandContext(ctx, executable, script)
	cmd.Stderr = os.Stderr
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		in.Close()
		return nil, err
	}
	return &Worker{cmd: cmd, in: in, out: bufio.NewReaderSize(out, 64*1024)}, nil
}

func (w *Worker) Close() error { w.in.Close(); return w.cmd.Wait() }

func (w *Worker) Build(files []ContentFile) (*Snapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	request, err := json.Marshal(map[string]any{"files": files})
	if err != nil {
		return nil, err
	}
	if _, err = w.in.Write(append(request, '\n')); err != nil {
		return nil, err
	}
	type reply struct {
		value []byte
		err   error
	}
	ch := make(chan reply, 1)
	go func() { value, err := w.out.ReadBytes('\n'); ch <- reply{value, err} }()
	var result reply
	select {
	case result = <-ch:
	case <-time.After(60 * time.Second):
		_ = w.cmd.Process.Kill()
		<-ch
		return nil, fmt.Errorf("content worker deadline exceeded")
	}
	if result.err != nil {
		return nil, result.err
	}
	var response struct {
		Result *Snapshot `json:"result"`
		Error  string    `json:"error"`
	}
	if err := json.Unmarshal(result.value, &response); err != nil {
		return nil, err
	}
	if response.Error != "" {
		return nil, fmt.Errorf("content validation: %s", response.Error)
	}
	if response.Result == nil || response.Result.Version != 1 || response.Result.Pages == nil {
		return nil, fmt.Errorf("invalid content snapshot")
	}
	for _, locale := range []string{"zh", "en"} {
		for _, section := range []string{"", "404/", "search/", "categories/", "tags/"} {
			var page Page
			if err := json.Unmarshal(response.Result.Pages["/"+locale+"/"+section], &page); err != nil || page.Locale != locale || page.Kind == "" || page.Metadata.Title == "" {
				return nil, fmt.Errorf("incomplete content page %s/%s", locale, section)
			}
		}
	}
	for _, document := range response.Result.Documents {
		if _, ok := response.Result.Pages[document.URL]; !ok {
			return nil, fmt.Errorf("search document without page")
		}
	}
	corpus, err := json.Marshal(Corpus{Version: 1, Documents: response.Result.Documents})
	if err != nil {
		return nil, err
	}
	if _, err := ReadCorpus(bytes.NewReader(corpus)); err != nil {
		return nil, err
	}
	return response.Result, nil
}

type ContentStore struct {
	Directory string
	Build     func([]ContentFile) (*Snapshot, error)
	mu        sync.Mutex
	files     []ContentFile
	snapshot  *Snapshot
}

// Load compares file bytes, not timestamps. The mutex publishes the complete
// immutable snapshot in one step; invalid changes fail the request, not stale-serve.
func (s *ContentStore) Load() (*Snapshot, error) {
	root, err := os.OpenRoot(s.Directory)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return s.LoadRoot(root)
}

func (s *ContentStore) LoadRoot(root *os.Root) (*Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	files := []ContentFile{}
	totalBytes := 0
	err := fs.WalkDir(root.FS(), ".", func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in content tree: %s", file)
		}
		if strings.HasPrefix(entry.Name(), ".") {
			if entry.IsDir() && file != "." {
				return fs.SkipDir
			}
			if !entry.IsDir() {
				return nil
			}
		}
		if entry.IsDir() || !(strings.HasSuffix(file, ".md") || strings.HasSuffix(file, ".mdx")) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Size() > 4<<20 {
			return fmt.Errorf("content file too large")
		}
		data, err := root.ReadFile(file)
		if err != nil {
			return err
		}
		if !utf8.Valid(data) {
			return fmt.Errorf("invalid UTF-8 content %s", file)
		}
		totalBytes += len(data)
		if totalBytes > 32<<20 {
			return fmt.Errorf("content tree exceeds 32 MiB")
		}
		files = append(files, ContentFile{file, string(data)})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	equal := len(files) == len(s.files)
	if equal {
		for i := range files {
			if files[i] != s.files[i] {
				equal = false
				break
			}
		}
	}
	if equal && s.snapshot != nil {
		return s.snapshot, nil
	}
	snapshot, err := s.Build(files)
	if err != nil {
		return nil, err
	}
	s.files, s.snapshot = files, snapshot
	return snapshot, nil
}
