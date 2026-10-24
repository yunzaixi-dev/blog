package web

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

type SearchDocument struct {
	URL     string `json:"url"`
	Locale  string `json:"locale"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Text    string `json:"text"`
	Image   string `json:"image"`
}

type Corpus struct {
	Version   int              `json:"version"`
	Documents []SearchDocument `json:"documents"`
}

func ReadCorpus(r io.Reader) (*Corpus, error) {
	var corpus Corpus
	decoder := json.NewDecoder(io.LimitReader(r, 32<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&corpus); err != nil {
		return nil, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("invalid trailing corpus data")
	}
	if corpus.Version != 1 || corpus.Documents == nil {
		return nil, fmt.Errorf("unsupported search corpus")
	}
	seen := map[string]bool{}
	for _, doc := range corpus.Documents {
		u, err := url.Parse(doc.URL)
		if err != nil || u.IsAbs() || u.Host != "" || !safePath(doc.URL) || !strings.HasPrefix(doc.URL, "/"+doc.Locale+"/") || (doc.Locale != "zh" && doc.Locale != "en") || strings.TrimSpace(doc.Title) == "" || strings.TrimSpace(doc.Text) == "" || seen[doc.URL] {
			return nil, fmt.Errorf("invalid search document %q", doc.URL)
		}
		seen[doc.URL] = true
	}
	return &corpus, nil
}

type SearchResult struct {
	URL     string `json:"url"`
	Excerpt string `json:"excerpt"`
	Meta    struct {
		Title string `json:"title"`
		Image string `json:"image,omitempty"`
	} `json:"meta"`
}

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func Search(w http.ResponseWriter, r *http.Request, documents []SearchDocument) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		jsonResponse(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	params, err := url.ParseQuery(r.URL.RawQuery)
	bad := err != nil
	for key, values := range params {
		if (key != "q" && key != "locale" && key != "limit") || len(values) != 1 {
			bad = true
		}
	}
	q := strings.TrimSpace(params.Get("q"))
	locale := params.Get("locale")
	limit := 10
	if v, ok := params["limit"]; ok {
		limit, err = strconv.Atoi(v[0])
		if err != nil {
			bad = true
		}
	}
	if bad || q == "" || !utf8.ValidString(q) || utf8.RuneCountInString(q) > 200 || (locale != "zh" && locale != "en") || limit < 1 || limit > 50 {
		jsonResponse(w, 400, map[string]string{"error": "invalid search parameters"})
		return
	}
	terms := strings.Fields(strings.ToLower(q))
	type hit struct {
		result SearchResult
		score  int
	}
	hits := []hit{}
	for _, doc := range documents {
		if doc.Locale != locale {
			continue
		}
		title, summary, text := strings.ToLower(doc.Title), strings.ToLower(doc.Summary), strings.ToLower(doc.Text)
		score := 0
		for _, term := range terms {
			weight := 0
			if strings.Contains(title, term) {
				weight += 10
			}
			if strings.Contains(summary, term) {
				weight += 3
			}
			if strings.Contains(text, term) {
				weight++
			}
			if weight == 0 {
				score = 0
				break
			}
			score += weight
		}
		if score == 0 {
			continue
		}
		result := SearchResult{URL: doc.URL, Excerpt: excerpt(doc.Text, terms[0])}
		result.Meta.Title = doc.Title
		result.Meta.Image = doc.Image
		hits = append(hits, hit{result, score})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score == hits[j].score {
			return hits[i].result.URL < hits[j].result.URL
		}
		return hits[i].score > hits[j].score
	})
	results := []SearchResult{}
	for i, hit := range hits {
		if i == limit {
			break
		}
		results = append(results, hit.result)
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		return
	}
	jsonResponse(w, 200, map[string]any{"results": results})
}

func excerpt(text, query string) string {
	runes := []rune(text)
	position := strings.Index(strings.ToLower(text), query)
	start := 0
	if position > 0 {
		start = utf8.RuneCountInString(strings.ToLower(text)[:position]) - 45
		if start < 0 {
			start = 0
		}
	}
	end := start + 180
	if end > len(runes) {
		end = len(runes)
	}
	prefix, suffix := "", ""
	if start > 0 {
		prefix = "…"
	}
	if end < len(runes) {
		suffix = "…"
	}
	return prefix + string(runes[start:end]) + suffix
}
