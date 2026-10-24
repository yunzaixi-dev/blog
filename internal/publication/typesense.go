package publication

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"zaixi.blog/server/internal/web"
)

type Typesense struct{ URL, Key string }

func (t Typesense) request(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	r, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(t.URL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	r.Header.Set("X-TYPESENSE-API-KEY", t.Key)
	r.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(r)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("typesense HTTP %d", response.StatusCode)
	}
	return data, nil
}
func (t Typesense) Index(ctx context.Context, revision int64, documents []web.SearchDocument) (map[string]string, error) {
	collections := map[string]string{}
	for _, locale := range []string{"zh", "en"} {
		name := fmt.Sprintf("blog_r%d_%s", revision, locale)
		fields := []map[string]any{}
		for _, field := range []string{"url", "locale", "title", "summary", "text", "image"} {
			f := map[string]any{"name": field, "type": "string"}
			if field == "title" || field == "summary" || field == "text" {
				f["locale"] = locale
			}
			fields = append(fields, f)
		}
		schema, _ := json.Marshal(map[string]any{"name": name, "fields": fields})
		if _, err := t.request(ctx, "POST", "/collections", schema); err != nil {
			return nil, err
		}
		var body bytes.Buffer
		count := 0
		for _, doc := range documents {
			if doc.Locale == locale {
				data, _ := json.Marshal(doc)
				body.Write(data)
				body.WriteByte('\n')
				count++
			}
		}
		if count > 0 {
			result, err := t.request(ctx, "POST", "/collections/"+name+"/documents/import?action=create", body.Bytes())
			if err != nil {
				return nil, err
			}
			scanner := bufio.NewScanner(bytes.NewReader(result))
			imported := 0
			for scanner.Scan() {
				var row struct {
					Success bool `json:"success"`
				}
				if err := json.Unmarshal(scanner.Bytes(), &row); err != nil || !row.Success {
					return nil, fmt.Errorf("typesense document import failed")
				}
				imported++
			}
			if err := scanner.Err(); err != nil {
				return nil, err
			}
			if imported != count {
				return nil, fmt.Errorf("typesense import count mismatch")
			}
		}
		data, err := t.request(ctx, "GET", "/collections/"+name, nil)
		if err != nil {
			return nil, err
		}
		var info struct {
			Count int `json:"num_documents"`
		}
		if err := json.Unmarshal(data, &info); err != nil {
			return nil, err
		}
		if info.Count != count {
			return nil, fmt.Errorf("typesense indexed count mismatch")
		}
		collections[locale] = name
	}
	return collections, nil
}
func (t Typesense) Search(w http.ResponseWriter, r *http.Request, collections map[string]string) {
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
	if value := params.Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		bad = bad || err != nil
	}
	if bad || q == "" || !utf8.ValidString(q) || utf8.RuneCountInString(q) > 200 || (locale != "zh" && locale != "en") || limit < 1 || limit > 50 {
		http.Error(w, "invalid search parameters", 400)
		return
	}
	query := url.Values{"q": {q}, "query_by": {"title,summary,text"}, "query_by_weights": {"10,3,1"}, "per_page": {strconv.Itoa(limit)}, "num_typos": {"0"}, "prefix": {"false"}}
	data, err := t.request(r.Context(), "GET", "/collections/"+url.PathEscape(collections[locale])+"/documents/search?"+query.Encode(), nil)
	if err != nil {
		http.Error(w, "search unavailable", 503)
		return
	}
	var response struct {
		Hits []struct {
			Document web.SearchDocument `json:"document"`
		} `json:"hits"`
	}
	if err = json.Unmarshal(data, &response); err != nil {
		http.Error(w, "search unavailable", 503)
		return
	}
	results := []web.SearchResult{}
	for _, hit := range response.Hits {
		result := web.SearchResult{URL: hit.Document.URL, Excerpt: hit.Document.Summary}
		if result.Excerpt == "" {
			text := []rune(hit.Document.Text)
			if len(text) > 180 {
				text = text[:180]
			}
			result.Excerpt = string(text)
		}
		result.Meta.Title = hit.Document.Title
		result.Meta.Image = hit.Document.Image
		results = append(results, result)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
	}
}
