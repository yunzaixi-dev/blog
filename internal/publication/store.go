package publication

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"zaixi.blog/server/internal/web"
)

//go:embed schema.sql
var Schema string

type Release struct {
	Revision    int64
	Snapshot    web.Snapshot
	Collections map[string]string
	Media       map[string]string
}

type Store struct {
	URL       string
	Typesense Typesense
	Static    *web.Static
}

func (s *Store) Read(ctx context.Context) (*Release, error) {
	conn, err := pgx.Connect(ctx, s.URL)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)
	var release Release
	var snapshot, collections, media []byte
	err = conn.QueryRow(ctx, `SELECT r.revision,r.snapshot,r.search_collections,r.media_manifest FROM publication p JOIN releases r ON r.revision=p.active_revision WHERE p.id=1`).Scan(&release.Revision, &snapshot, &collections, &media)
	if err != nil {
		return nil, fmt.Errorf("publication unavailable: %w", err)
	}
	if err = json.Unmarshal(snapshot, &release.Snapshot); err != nil {
		return nil, err
	}
	if err = json.Unmarshal(collections, &release.Collections); err != nil {
		return nil, err
	}
	if err = json.Unmarshal(media, &release.Media); err != nil {
		return nil, err
	}
	return &release, nil
}

func (s *Store) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", 405)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	release, err := s.Read(ctx)
	if err != nil {
		http.Error(w, "publication unavailable", 503)
		return
	}
	w.Header().Set("X-Content-Revision", strconv.FormatInt(release.Revision, 10))
	w.Header().Set("Access-Control-Expose-Headers", "X-Content-Revision")
	redirects, err := s.Static.WithRedirects(release.Snapshot.Redirects)
	if err != nil {
		http.Error(w, "publication unavailable", 503)
		return
	}
	if redirects.Redirect(w, r) {
		return
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		if target, ok := release.Media[r.URL.Path]; ok {
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, target, 302)
			return
		}
	}
	if strings.HasPrefix(r.URL.Path, "/static/") || strings.HasPrefix(r.URL.Path, "/forum/") {
		http.NotFound(w, r)
		return
	}
	static := *s.Static
	h := &web.Handler{Static: &static, Load: func() (*web.Snapshot, error) { return &release.Snapshot, nil }, Search: func(w http.ResponseWriter, r *http.Request) { s.Typesense.Search(w, r, release.Collections) }}
	static.Shell = h.Shell
	static.PageExists = func(string) bool { return true }
	h.ServeHTTP(w, r)
}

func FromEnv(static *web.Static) *Store {
	return &Store{URL: os.Getenv("DATABASE_URL"), Static: static, Typesense: Typesense{URL: os.Getenv("TYPESENSE_URL"), Key: os.Getenv("TYPESENSE_API_KEY")}}
}
