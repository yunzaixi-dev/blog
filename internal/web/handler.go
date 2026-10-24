package web

import (
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
)

type Handler struct {
	Content *ContentStore
	Static  *Static
	Media   *Static
	Load    func() (*Snapshot, error)
	Search  func(http.ResponseWriter, *http.Request)
}

func (h *Handler) load() (*Snapshot, error) {
	if h.Load != nil {
		return h.Load()
	}
	return h.Content.Load()
}

func normalizeRoute(value string) string {
	if !safePath(value) {
		return ""
	}
	return strings.TrimRight(path.Clean(value), "/") + "/"
}

func pageFor(snapshot *Snapshot, route string) (json.RawMessage, bool) {
	page, ok := snapshot.Pages[normalizeRoute(route)]
	if ok && !strings.HasSuffix(normalizeRoute(route), "/404/") {
		return page, true
	}
	locale := "zh"
	if strings.HasPrefix(route, "/en/") || route == "/en" {
		locale = "en"
	}
	return snapshot.Pages["/"+locale+"/404/"], false
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	securityHeaders(w)
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		jsonResponse(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	if r.URL.Path == "/api/search" || r.URL.Path == "/api/page" {
		snapshot, err := h.load()
		if err != nil {
			h.unavailable(w, err)
			return
		}
		if r.URL.Path == "/api/search" {
			if h.Search != nil {
				h.Search(w, r)
				return
			}
			Search(w, r, snapshot.Documents)
			return
		}
		params, parseErr := url.ParseQuery(r.URL.RawQuery)
		if parseErr != nil || len(params) != 1 || len(params["path"]) != 1 || !safePath(params.Get("path")) || strings.ContainsAny(params.Get("path"), "?#") {
			jsonResponse(w, 400, map[string]string{"error": "invalid page path"})
			return
		}
		page, exists := pageFor(snapshot, params.Get("path"))
		status := 200
		if !exists {
			status = 404
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		if r.Method != http.MethodHead {
			_, _ = w.Write(page)
		}
		return
	}
	if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
		jsonResponse(w, 404, map[string]string{"error": "not found"})
		return
	}
	if (strings.HasPrefix(r.URL.Path, "/static/") || strings.HasPrefix(r.URL.Path, "/forum/")) && h.Media != nil {
		media := *h.Media
		media.redirects = h.Static.redirects
		media.ServeHTTP(w, r)
		return
	}
	if r.URL.Path == "/feed.xml" || r.URL.Path == "/sitemap.xml" || r.URL.Path == "/robots.txt" || strings.HasPrefix(r.URL.Path, "/export/") || strings.HasSuffix(r.URL.Path, "/feed.xml") {
		snapshot, err := h.load()
		if err != nil {
			h.unavailable(w, err)
			return
		}
		body, ok := snapshot.Feeds[r.URL.Path]
		contentType := "application/rss+xml; charset=utf-8"
		if r.URL.Path == "/sitemap.xml" {
			body, ok, contentType = snapshot.Sitemap, true, "application/xml; charset=utf-8"
		}
		if r.URL.Path == "/robots.txt" {
			body, ok, contentType = snapshot.Robots, true, "text/plain; charset=utf-8"
		}
		if strings.HasPrefix(r.URL.Path, "/export/") {
			body, ok = snapshot.Exports[r.URL.Path]
			contentType = "text/markdown; charset=utf-8"
			w.Header().Set("X-Robots-Tag", "noindex")
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodHead {
			_, _ = w.Write([]byte(body))
		}
		return
	}
	h.Static.ServeHTTP(w, r)
}

func (h *Handler) unavailable(w http.ResponseWriter, err error) {
	log.Printf("content unavailable: %v", err)
	jsonResponse(w, 503, map[string]string{"error": "content unavailable"})
}

var htmlLang = regexp.MustCompile(`<html\s+lang="[^"]*"`)
var titleTag = regexp.MustCompile(`<title>[^<]*</title>`)

func (h *Handler) Shell(w http.ResponseWriter, r *http.Request) {
	snapshot, err := h.load()
	if err != nil {
		h.unavailable(w, err)
		return
	}
	data, exists := pageFor(snapshot, r.URL.Path)
	var page Page
	if err := json.Unmarshal(data, &page); err != nil {
		h.unavailable(w, err)
		return
	}
	shell, err := h.Static.Root.ReadFile("index.html")
	if err != nil {
		h.unavailable(w, err)
		return
	}
	text := htmlLang.ReplaceAllString(string(shell), `<html lang="`+snapshot.Locales[page.Locale]+`"`)
	text = titleTag.ReplaceAllStringFunc(text, func(string) string { return "<title>" + html.EscapeString(page.Metadata.Title) + "</title>" })
	head := ""
	meta := func(key, value string) {
		if value != "" {
			attribute := "property"
			if key == "description" || strings.HasPrefix(key, "twitter:") {
				attribute = "name"
			}
			head += fmt.Sprintf(`<meta data-runtime-head %s="%s" content="%s">`, attribute, key, html.EscapeString(value))
		}
	}
	meta("description", page.Metadata.Description)
	head += `<link data-runtime-head rel="canonical" href="` + html.EscapeString(page.Metadata.Canonical) + `">`
	for lang, href := range page.Metadata.Languages {
		head += `<link data-runtime-head rel="alternate" hreflang="` + html.EscapeString(lang) + `" href="` + html.EscapeString(href) + `">`
	}
	meta("og:title", page.Metadata.Title)
	meta("og:description", page.Metadata.Description)
	meta("og:url", page.Metadata.Canonical)
	meta("og:locale", strings.ReplaceAll(snapshot.Locales[page.Locale], "-", "_"))
	meta("og:type", page.Metadata.Type)
	meta("og:image", page.Metadata.Image)
	meta("og:site_name", "zaixi.dev")
	meta("twitter:card", "summary_large_image")
	meta("twitter:title", page.Metadata.Title)
	meta("twitter:description", page.Metadata.Description)
	meta("twitter:image", page.Metadata.Image)
	meta("article:published_time", page.Metadata.Published)
	meta("article:modified_time", page.Metadata.Modified)
	if len(page.Metadata.JSONLD) > 0 {
		var value any
		if json.Unmarshal(page.Metadata.JSONLD, &value) == nil {
			safe, _ := json.Marshal(value)
			head += `<script data-runtime-head type="application/ld+json">` + string(safe) + `</script>`
		}
	}
	if !exists {
		head += `<meta data-runtime-head name="robots" content="noindex">`
		w.Header().Set("X-Robots-Tag", "noindex")
	}
	text = strings.Replace(text, "</head>", head+"</head>", 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	status := 200
	if !exists {
		status = 404
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write([]byte(text))
	}
}
