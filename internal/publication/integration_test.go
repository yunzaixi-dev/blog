package publication

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"zaixi.blog/server/internal/web"
)

func TestPublicationIntegration(t *testing.T) {
	if os.Getenv("BLOG_INTEGRATION") != "1" {
		t.Skip("set BLOG_INTEGRATION=1 with isolated PostgreSQL, Typesense and S3")
	}
	if !strings.Contains(os.Getenv("DATABASE_URL"), "blog-local-only") {
		t.Fatal("integration requires dedicated local database identity")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	if _, err = conn.Exec(ctx, Schema); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"blog_reader", "blog_publisher"} {
		var exists bool
		if err = conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)`, role).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if !exists {
			if _, err = conn.Exec(ctx, `CREATE ROLE `+role+` NOLOGIN`); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err = conn.Exec(ctx, Schema); err != nil {
		t.Fatal(err)
	}
	worker, err := web.StartWorker(ctx, "node", filepath.Join("..", "..", "dist", "worker", "content-worker.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	importer := ImporterFromEnv(worker.Build)
	_, err = importer.S3.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(importer.Bucket)})
	if err != nil {
		if _, headErr := importer.S3.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(importer.Bucket)}); headErr != nil {
			t.Fatal(err, headErr)
		}
	}
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, importer.Bucket)
	if _, err = importer.S3.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{Bucket: aws.String(importer.Bucket), Policy: aws.String(policy)}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for _, name := range []string{"content/blog/zh", "public/static/images"} {
		if err = os.MkdirAll(filepath.Join(dir, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err = os.WriteFile(filepath.Join(dir, "public/static/images/avatar.webp"), []byte("avatar"), 0644); err != nil {
		t.Fatal(err)
	}
	article := filepath.Join(dir, "content/blog/zh/live.md")
	write := func(body string, draft bool) {
		t.Helper()
		source := fmt.Sprintf("---\ntitle: IntegrationUnique\ndate: 2026-10-24\ndraft: %t\nimage: https://zaixi.dev/static/images/photo.webp\n---\n%s\n\n![photo](https://zaixi.dev/static/images/photo.webp)\n", draft, body)
		if err = os.WriteFile(article, []byte(source), 0644); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, "public/static/images/photo.webp"), []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("FirstUniqueBody 中文检索验证", false)
	if err = os.WriteFile(filepath.Join(dir, "public/_redirects"), []byte("/old /zh/live/ 301\n"), 0644); err != nil {
		t.Fatal(err)
	}
	static, err := web.NewStatic(filepath.Join("..", "..", "out"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer static.Root.Close()
	api := httptest.NewServer(web.CORS(FromEnv(static), "https://zaixi.dev"))
	defer api.Close()
	// Before the first committed release, no publication is available.
	if _, err = conn.Exec(ctx, `UPDATE publication SET active_revision=NULL,phase='syncing',desired_source_sha='' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest("GET", api.URL+"/api/page?path=/zh/", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "https://zaixi.dev")
	initial, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	initial.Body.Close()
	if initial.StatusCode != 503 || initial.Header.Get("Access-Control-Allow-Origin") != "https://zaixi.dev" {
		t.Fatal(initial.StatusCode, initial.Header)
	}
	get := func(route string) *http.Response {
		t.Helper()
		r, err := http.Get(api.URL + route)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	rev, err := importer.Import(ctx, dir, "first")
	if err != nil {
		t.Fatal(err)
	}
	if same, err := importer.Import(ctx, dir, "first"); err != nil || same != rev {
		t.Fatal("same source is not idempotent", same, err)
	}
	r := get("/api/page?path=/zh/live/")
	var page map[string]any
	if err = json.NewDecoder(r.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	redirect, err := client.Get(api.URL + "/static/images/photo.webp")
	if err != nil {
		t.Fatal(err)
	}
	redirect.Body.Close()
	if redirect.StatusCode != 302 || !strings.Contains(redirect.Header.Get("Location"), fmt.Sprintf("releases/%d/", rev)) {
		t.Fatal(redirect.StatusCode, redirect.Header)
	}
	if r.StatusCode != 200 || r.Header.Get("X-Content-Revision") != fmt.Sprint(rev) {
		t.Fatal(r.StatusCode, r.Header)
	}
	data, _ := json.Marshal(page)
	if strings.Contains(string(data), `"raw"`) || strings.Contains(string(data), `"draft"`) || !strings.Contains(string(data), fmt.Sprintf("releases/%d/static/images/photo.webp", rev)) {
		t.Fatal(string(data))
	}
	if strings.Contains(string(data), "https://zaixi.dev/static/images/photo.webp") {
		t.Fatal("absolute cover/body/metadata/JSON-LD retained old origin", string(data))
	}
	exported := get("/export/zh/live.md")
	exportBody, _ := io.ReadAll(exported.Body)
	exported.Body.Close()
	if strings.Contains(string(exportBody), "https://zaixi.dev/static/images/photo.webp") || !strings.Contains(string(exportBody), fmt.Sprintf("releases/%d/static/images/photo.webp", rev)) {
		t.Fatal(string(exportBody))
	}
	if _, err = conn.Exec(ctx, `UPDATE publication SET phase='syncing' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"/api/page?path=/zh/live/", "/api/search?q=FirstUniqueBody&locale=zh"} {
		r = get(route)
		if r.StatusCode != 200 || r.Header.Get("X-Content-Revision") != fmt.Sprint(rev) {
			t.Fatal(route, r.StatusCode, r.Header)
		}
		r.Body.Close()
	}
	object, err := importer.S3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(importer.Bucket), Key: aws.String(fmt.Sprintf("releases/%d/static/images/photo.webp", rev))})
	if err != nil {
		t.Fatal(err)
	}
	object.Body.Close()
	publicObject, err := http.Get(strings.TrimRight(os.Getenv("S3_ENDPOINT"), "/") + "/" + importer.Bucket + fmt.Sprintf("/releases/%d/static/images/photo.webp", rev))
	if err != nil {
		t.Fatal(err)
	}
	publicBody, _ := io.ReadAll(publicObject.Body)
	publicObject.Body.Close()
	if publicObject.StatusCode != 200 || string(publicBody) != "FirstUniqueBody 中文检索验证" {
		t.Fatal(publicObject.StatusCode, string(publicBody))
	}
	for _, route := range []string{"/api/search?q=FirstUniqueBody&locale=zh", "/feed.xml"} {
		r = get(route)
		if r.StatusCode != 200 {
			t.Fatal(route, r.StatusCode)
		}
		body, _ := io.ReadAll(r.Body)
		r.Body.Close()
		if !strings.Contains(string(body), "IntegrationUnique") {
			t.Fatal(route, string(body))
		}
	}
	r = get("/api/search?q=%E4%B8%AD%E6%96%87&locale=zh")
	var chinese struct {
		Results []any `json:"results"`
	}
	if err = json.NewDecoder(r.Body).Decode(&chinese); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 200 || len(chinese.Results) != 1 {
		t.Fatal(r.StatusCode, chinese)
	}
	write("SecondUniqueBody", false)
	next, err := importer.Import(ctx, dir, "second")
	if err != nil || next <= rev {
		t.Fatal(next, err)
	}
	r = get("/api/page?path=/zh/live/")
	if r.Header.Get("X-Content-Revision") != fmt.Sprint(next) {
		t.Fatal(r.Header)
	}
	r.Body.Close()
	// Index or parser failures also leave active_revision unchanged.
	badIndex := *importer
	badIndex.Typesense.URL = "http://127.0.0.1:1"
	if _, err = badIndex.Import(ctx, dir, "failed-index"); err == nil {
		t.Fatal("broken index published")
	}
	var unchanged int64
	if err = conn.QueryRow(ctx, `SELECT active_revision FROM publication WHERE id=1`).Scan(&unchanged); err != nil || unchanged != next {
		t.Fatal(unchanged, err)
	}
	if _, err = importer.Import(ctx, dir, "recover-index"); err != nil {
		t.Fatal(err)
	}
	if err = conn.QueryRow(ctx, `SELECT active_revision FROM publication WHERE id=1`).Scan(&next); err != nil {
		t.Fatal(err)
	}
	// An R2 error cannot advance active_revision; failed publication is explicit.
	bad := *importer
	bad.Bucket = "missing-integration-bucket"
	if _, err = bad.Import(ctx, dir, "failed-media"); err == nil {
		t.Fatal("missing bucket published")
	}
	var active int64
	var phase string
	if err = conn.QueryRow(ctx, `SELECT active_revision,phase FROM publication WHERE id=1`).Scan(&active, &phase); err != nil || active != next || phase != "failed" {
		t.Fatal(active, phase, err)
	}
	r = get("/api/page?path=/zh/live/")
	if r.StatusCode != 200 || r.Header.Get("X-Content-Revision") != fmt.Sprint(next) {
		t.Fatal(r.StatusCode)
	}
	r.Body.Close()
	r = get("/api/search?q=SecondUniqueBody&locale=zh")
	if r.StatusCode != 200 || r.Header.Get("X-Content-Revision") != fmt.Sprint(next) {
		t.Fatal(r.StatusCode, r.Header)
	}
	r.Body.Close()
	if _, err = importer.Import(ctx, dir, "recovered"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(article, []byte("---\ntitle: [broken\n---\ninvalid"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = importer.Import(ctx, dir, "failed-parser"); err == nil {
		t.Fatal("invalid document published")
	}
	r = get("/api/page?path=/zh/live/")
	if r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	r.Body.Close()
	write("SecondUniqueBody", false)
	if _, err = importer.Import(ctx, dir, "recover-parser"); err != nil {
		t.Fatal(err)
	}
	// Typesense failures are 503, never a local-memory search fallback.
	failure := *FromEnv(static)
	failure.Typesense.URL = "http://127.0.0.1:1"
	w := httptest.NewRecorder()
	failure.ServeHTTP(w, httptest.NewRequest("GET", "/api/search?q=SecondUniqueBody&locale=zh", nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	write("DraftSecretBody", true)
	if _, err = importer.Import(ctx, dir, "draft"); err != nil {
		t.Fatal(err)
	}
	r = get("/api/page?path=/zh/live/")
	if r.StatusCode != 404 {
		t.Fatal(r.StatusCode)
	}
	r.Body.Close()
	r = get("/api/search?q=DraftSecretBody&locale=zh")
	var search struct {
		Results []any `json:"results"`
	}
	json.NewDecoder(r.Body).Decode(&search)
	r.Body.Close()
	if len(search.Results) != 0 {
		t.Fatal(search)
	}
	if err = os.Remove(article); err != nil {
		t.Fatal(err)
	}
	if _, err = importer.Import(ctx, dir, "deleted"); err != nil {
		t.Fatal(err)
	}
	r = get("/api/page?path=/zh/live/")
	if r.StatusCode != 404 {
		t.Fatal(r.StatusCode)
	}
	r.Body.Close()
	// Verify the actual migration grants, not just superuser integration behavior.
	for _, role := range []string{"blog_reader", "blog_publisher"} {
		tx, err := conn.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `SET LOCAL ROLE `+role); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `SELECT active_revision FROM publication WHERE id=1`); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `DELETE FROM releases`); err == nil {
			t.Fatal("release deletion allowed", role)
		}
		_ = tx.Rollback(ctx)
	}
	// S3 remains an independent persistent object store after withdrawal.
	_, err = importer.S3.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(importer.Bucket)})
	if err != nil {
		t.Fatal(err)
	}
}
