package web

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
)

type redirect struct {
	source, target string
	status         int
}

type Static struct {
	Root       *os.Root
	redirects  []redirect
	PageExists func(string) bool
	Shell      func(http.ResponseWriter, *http.Request)
}

func (s *Static) WithRedirects(text string) (*Static, error) {
	copy := *s
	copy.redirects = nil
	scanner := bufio.NewScanner(strings.NewReader(text))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 || strings.HasPrefix(fields[0], "#") {
			continue
		}
		if len(fields) < 2 || len(fields) > 3 {
			return nil, fmt.Errorf("invalid redirect")
		}
		status := 302
		if len(fields) == 3 {
			if _, err := fmt.Sscan(fields[2], &status); err != nil {
				return nil, err
			}
		}
		if status != 301 && status != 302 && status != 307 && status != 308 {
			return nil, fmt.Errorf("invalid redirect status")
		}
		if !strings.HasPrefix(fields[1], "/") || strings.HasPrefix(fields[1], "//") {
			return nil, fmt.Errorf("invalid redirect target")
		}
		copy.redirects = append(copy.redirects, redirect{fields[0], fields[1], status})
	}
	return &copy, scanner.Err()
}

func (s *Static) Redirect(w http.ResponseWriter, r *http.Request) bool {
	for _, rule := range s.redirects {
		match := rule.source == r.URL.Path
		splat := ""
		if before, after, ok := strings.Cut(rule.source, "*"); ok && strings.HasPrefix(r.URL.Path, before) && strings.HasSuffix(r.URL.Path, after) && len(r.URL.Path) >= len(before)+len(after) {
			match = true
			splat = r.URL.Path[len(before) : len(r.URL.Path)-len(after)]
		}
		if match {
			segments := strings.Split(splat, "/")
			for index := range segments {
				segments[index] = url.PathEscape(segments[index])
			}
			target := strings.ReplaceAll(rule.target, ":splat", strings.Join(segments, "/"))
			if r.URL.RawQuery != "" {
				separator := "?"
				if strings.Contains(target, "?") {
					separator = "&"
				}
				target += separator + r.URL.RawQuery
			}
			http.Redirect(w, r, target, rule.status)
			return true
		}
	}
	return false
}

func NewStatic(directory string, exists func(string) bool) (*Static, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	return NewStaticRoot(root, exists)
}

// NewStaticRoot takes ownership of root, including on validation failure.
func NewStaticRoot(root *os.Root, exists func(string) bool) (*Static, error) {
	s := &Static{Root: root, PageExists: exists}
	info, err := root.Lstat("_redirects")
	if err != nil || !info.Mode().IsRegular() {
		root.Close()
		return nil, fmt.Errorf("redirects must be a regular file")
	}
	f, err := root.Open("_redirects")
	if err != nil {
		root.Close()
		return nil, fmt.Errorf("redirects: %w", err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 || len(fields) > 3 {
			root.Close()
			return nil, fmt.Errorf("invalid redirect: %s", line)
		}
		status := http.StatusFound
		if len(fields) == 3 {
			if _, err = fmt.Sscan(fields[2], &status); err != nil {
				root.Close()
				return nil, err
			}
		}
		if status != 301 && status != 302 && status != 307 && status != 308 {
			root.Close()
			return nil, fmt.Errorf("unsupported redirect status %d", status)
		}
		target, err := url.Parse(fields[1])
		if err != nil || target.IsAbs() || !strings.HasPrefix(fields[1], "/") || strings.HasPrefix(fields[1], "//") {
			root.Close()
			return nil, fmt.Errorf("invalid redirect destination")
		}
		s.redirects = append(s.redirects, redirect{fields[0], fields[1], status})
	}
	if err := scanner.Err(); err != nil {
		root.Close()
		return nil, err
	}
	return s, nil
}

func securityHeaders(w http.ResponseWriter) {
	mediaOrigin := ""
	if media, err := url.Parse(os.Getenv("MEDIA_BASE_URL")); err == nil && (media.Scheme == "http" || media.Scheme == "https") && media.Host != "" && media.User == nil {
		mediaOrigin = " " + media.Scheme + "://" + media.Host
	}
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' analytics.umami.is https://s3.tradingview.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:"+mediaOrigin+"; media-src 'self'"+mediaOrigin+"; connect-src 'self' analytics.umami.is; font-src 'self'; frame-src https://www.tradingview-widget.com https://s.tradingview.com")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
}

func safePath(value string) bool {
	if !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\\\x00") {
		return false
	}
	for _, segment := range strings.Split(value, "/") {
		if strings.HasPrefix(segment, ".") {
			return false
		}
	}
	return true
}

func (s *Static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	securityHeaders(w)
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", 405)
		return
	}
	if !safePath(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	for _, rule := range s.redirects {
		match := rule.source == r.URL.Path
		splat := ""
		if before, after, ok := strings.Cut(rule.source, "*"); ok && strings.HasPrefix(r.URL.Path, before) && strings.HasSuffix(r.URL.Path, after) && len(r.URL.Path) >= len(before)+len(after) {
			match = true
			splat = r.URL.Path[len(before) : len(r.URL.Path)-len(after)]
		}
		if match {
			segments := strings.Split(splat, "/")
			for i := range segments {
				segments[i] = url.PathEscape(segments[i])
			}
			target := strings.ReplaceAll(rule.target, ":splat", strings.Join(segments, "/"))
			if r.URL.RawQuery != "" {
				separator := "?"
				if strings.Contains(target, "?") {
					separator = "&"
				}
				target += separator + r.URL.RawQuery
			}
			w.Header().Set("Location", target)
			w.WriteHeader(rule.status)
			return
		}
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "." {
		name = "index.html"
	}
	if name == "index.html" && s.Shell != nil {
		s.Shell(w, r)
		return
	}
	if strings.HasPrefix(name, "_") {
		http.NotFound(w, r)
		return
	}
	// Content and asset roots contain regular files only; denying symlinks also
	// prevents an innocently named link from exposing an internal dotfile.
	parts := strings.Split(name, "/")
	for i := range parts {
		info, err := s.Root.Lstat(strings.Join(parts[:i+1], "/"))
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			http.NotFound(w, r)
			return
		}
	}
	f, err := s.Root.Open(name)
	if err == nil {
		info, statErr := f.Stat()
		if statErr != nil {
			f.Close()
			http.NotFound(w, r)
			return
		}
		if info.IsDir() {
			f.Close()
			name = path.Join(name, "index.html")
			f, err = s.Root.Open(name)
		}
	}
	if err == nil {
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if strings.HasPrefix(name, "static/") {
			w.Header().Set("Cache-Control", "public, max-age=3600, must-revalidate")
		}
		if strings.HasPrefix(name, "export/") {
			w.Header().Set("X-Robots-Tag", "noindex")
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		}
		w.Header().Set("ETag", fmt.Sprintf(`"%x-%x"`, info.ModTime().UnixNano(), info.Size()))
		http.ServeContent(w, r, name, info.ModTime(), f)
		return
	}
	if path.Ext(name) != "" || strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "static/") {
		http.NotFound(w, r)
		return
	}
	if s.PageExists != nil && s.PageExists(r.URL.Path) {
		s.serveShell(w, r, 200)
		return
	}
	s.serveShell(w, r, 404)
}

func (s *Static) serveShell(w http.ResponseWriter, r *http.Request, status int) {
	if s.Shell != nil {
		s.Shell(w, r)
		return
	}
	f, err := s.Root.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if status == 404 {
		w.Header().Set("X-Robots-Tag", "noindex")
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, f)
	}
}
