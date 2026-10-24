package publication

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"zaixi.blog/server/internal/web"
)

type Importer struct {
	URL               string
	Typesense         Typesense
	S3                *s3.Client
	Bucket, MediaBase string
	Build             func([]web.ContentFile) (*web.Snapshot, error)
}

func ImporterFromEnv(build func([]web.ContentFile) (*web.Snapshot, error)) *Importer {
	endpoint := os.Getenv("S3_ENDPOINT")
	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "auto"
	}
	client := s3.New(s3.Options{Region: region, BaseEndpoint: aws.String(endpoint), Credentials: credentials.NewStaticCredentialsProvider(os.Getenv("S3_ACCESS_KEY_ID"), os.Getenv("S3_SECRET_ACCESS_KEY"), ""), UsePathStyle: os.Getenv("S3_FORCE_PATH_STYLE") == "true"})
	return &Importer{URL: os.Getenv("DATABASE_URL"), Typesense: Typesense{URL: os.Getenv("TYPESENSE_URL"), Key: os.Getenv("TYPESENSE_API_KEY")}, S3: client, Bucket: os.Getenv("R2_BUCKET"), MediaBase: strings.TrimRight(os.Getenv("MEDIA_BASE_URL"), "/"), Build: build}
}

func (i *Importer) InitializeLocalBucket(ctx context.Context) error {
	if os.Getenv("S3_FORCE_PATH_STYLE") != "true" || (!strings.HasPrefix(os.Getenv("S3_ENDPOINT"), "http://minio:") && !strings.HasPrefix(os.Getenv("S3_ENDPOINT"), "http://127.0.0.1:")) {
		return fmt.Errorf("local bucket initialization requires the isolated S3 endpoint")
	}
	_, err := i.S3.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(i.Bucket)})
	if err != nil {
		if _, headErr := i.S3.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(i.Bucket)}); headErr != nil {
			return fmt.Errorf("create local bucket: %w; access check: %v", err, headErr)
		}
	}
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, i.Bucket)
	_, err = i.S3.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{Bucket: aws.String(i.Bucket), Policy: aws.String(policy)})
	return err
}

var mediaReference = regexp.MustCompile(`(?:src|poster)=["']((?:https://(?:zaixi\.dev|api\.zaixi\.dev))?/(?:static|forum)/[^"'<>]+)["']|!\[[^\]]*\]\(((?:https://(?:zaixi\.dev|api\.zaixi\.dev))?/(?:static|forum)/[^\s)]+)`)
var codeText = regexp.MustCompile("(?s)```.*?```|~~~.*?~~~|`[^`]*`")

func mediaPath(value string) string {
	for _, origin := range []string{"https://zaixi.dev/", "https://api.zaixi.dev/"} {
		if strings.HasPrefix(value, origin) {
			value = value[len(origin)-1:]
			break
		}
	}
	if strings.HasPrefix(value, "/static/") || strings.HasPrefix(value, "/forum/") {
		return value
	}
	return ""
}

func resourceField(key string) bool {
	switch key {
	case "image", "images", "src", "poster", "avatar", "sourceUrl", "href", "url", "contentUrl", "thumbnailUrl":
		return true
	}
	return false
}

// Walk public URL fields and image markup using the same rules for discovery and
// rewriting. Code nodes and inline/fenced code remain literal author text.
func projectMedia(value any, key string, visit func(string) string) any {
	switch value := value.(type) {
	case map[string]any:
		if tag, _ := value["tag"].(string); tag == "code" || tag == "pre" {
			return value
		}
		for field, item := range value {
			value[field] = projectMedia(item, field, visit)
		}
		return value
	case []any:
		for index, item := range value {
			value[index] = projectMedia(item, key, visit)
		}
		return value
	case string:
		if resourceField(key) && mediaPath(value) != "" {
			return visit(value)
		}
		var out strings.Builder
		start := 0
		rewrite := func(text string) string {
			return mediaReference.ReplaceAllStringFunc(text, func(match string) string {
				parts := mediaReference.FindStringSubmatch(match)
				for _, source := range parts[1:] {
					if source != "" {
						return strings.Replace(match, source, visit(source), 1)
					}
				}
				return match
			})
		}
		for _, span := range codeText.FindAllStringIndex(value, -1) {
			out.WriteString(rewrite(value[start:span[0]]))
			out.WriteString(value[span[0]:span[1]])
			start = span[1]
		}
		out.WriteString(rewrite(value[start:]))
		return out.String()
	}
	return value
}

func referencedMedia(value any, paths map[string]bool) {
	projectMedia(value, "", func(source string) string {
		if name := mediaPath(source); name != "" {
			paths[name] = true
		}
		return source
	})
}

func scrub(value any) any {
	switch value := value.(type) {
	case map[string]any:
		for key, item := range value {
			if key == "_raw" || key == "raw" || key == "draft" || key == "sourcePosts" {
				delete(value, key)
			} else {
				value[key] = scrub(item)
			}
		}
	case []any:
		for i, item := range value {
			value[i] = scrub(item)
		}
	}
	return value
}

func (i *Importer) media(ctx context.Context, root *os.Root, revision int64, snapshot *web.Snapshot) (*web.Snapshot, map[string]string, error) {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return nil, nil, err
	}
	var projection any
	if err = json.Unmarshal(data, &projection); err != nil {
		return nil, nil, err
	}
	projection = scrub(projection)
	data, err = json.Marshal(projection)
	if err != nil {
		return nil, nil, err
	}
	paths := map[string]bool{}
	referencedMedia(projection, paths)
	manifest := map[string]string{}
	ordered := []string{}
	for value := range paths {
		ordered = append(ordered, value)
	}
	sort.Strings(ordered)
	for _, value := range ordered {
		if path.Clean(value) != value || strings.ContainsAny(value, "?#") {
			return nil, nil, fmt.Errorf("invalid media reference")
		}
		name := strings.TrimPrefix(value, "/")
		parts := strings.Split(name, "/")
		for index, part := range parts {
			if strings.HasPrefix(part, ".") {
				return nil, nil, fmt.Errorf("hidden media path")
			}
			info, err := root.Lstat(strings.Join(parts[:index+1], "/"))
			if err != nil {
				return nil, nil, fmt.Errorf("missing media %s: %w", value, err)
			}
			if info.Mode()&os.ModeSymlink != 0 {
				return nil, nil, fmt.Errorf("symlink media %s", value)
			}
		}
		file, err := root.Open(name)
		if err != nil {
			return nil, nil, err
		}
		info, err := file.Stat()
		if err != nil {
			file.Close()
			return nil, nil, err
		}
		if !info.Mode().IsRegular() || info.Size() > 32<<20 {
			file.Close()
			return nil, nil, fmt.Errorf("invalid media file")
		}
		body, err := io.ReadAll(io.LimitReader(file, 32<<20))
		file.Close()
		if err != nil {
			return nil, nil, err
		}
		key := "releases/" + strconv.FormatInt(revision, 10) + "/" + name
		contentType := mime.TypeByExtension(path.Ext(name))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		_, err = i.S3.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(i.Bucket), Key: aws.String(key), Body: bytes.NewReader(body), ContentType: aws.String(contentType), CacheControl: aws.String("public, max-age=31536000, immutable")})
		if err != nil {
			return nil, nil, fmt.Errorf("media upload: %w", err)
		}
		manifest[value] = i.MediaBase + "/" + key
	}
	data, err = json.Marshal(projectMedia(projection, "", func(source string) string {
		if target, ok := manifest[mediaPath(source)]; ok {
			return target
		}
		return source
	}))
	if err != nil {
		return nil, nil, err
	}
	var published web.Snapshot
	err = json.Unmarshal(data, &published)
	return &published, manifest, err
}

func (i *Importer) Import(ctx context.Context, checkout, sha string) (revision int64, err error) {
	if i.Bucket == "" || i.MediaBase == "" || i.Typesense.URL == "" || i.Typesense.Key == "" {
		return 0, fmt.Errorf("publication requires S3 bucket, media base and Typesense configuration")
	}
	conn, err := pgx.Connect(ctx, i.URL)
	if err != nil {
		return 0, err
	}
	defer conn.Close(context.Background())
	if _, err = conn.Exec(ctx, `SELECT pg_advisory_lock(9245101)`); err != nil {
		return 0, err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock(9245101)`)
	var previousSHA, previousPhase string
	if err = conn.QueryRow(ctx, `SELECT desired_source_sha,phase FROM publication WHERE id=1`).Scan(&previousSHA, &previousPhase); err != nil {
		return 0, err
	}
	if previousSHA == sha && previousPhase == "ready" {
		err = conn.QueryRow(ctx, `SELECT active_revision FROM publication WHERE id=1`).Scan(&revision)
		return revision, err
	}
	if _, err = conn.Exec(ctx, `UPDATE publication SET desired_source_sha=$1,phase='syncing',error_code='',updated_at=now() WHERE id=1`, sha); err != nil {
		return 0, err
	}
	phase := "parse_failed"
	defer func() {
		if err != nil {
			failureCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_, recordErr := conn.Exec(failureCtx, `UPDATE publication SET phase='failed',error_code=$1,updated_at=now() WHERE id=1`, phase)
			if recordErr != nil {
				err = fmt.Errorf("%w; failure recording: %v", err, recordErr)
			}
		}
	}()
	root, err := os.OpenRoot(checkout)
	if err != nil {
		return 0, err
	}
	defer root.Close()
	for _, name := range []string{"content", "public"} {
		info, e := root.Lstat(name)
		if e != nil {
			return 0, e
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return 0, fmt.Errorf("invalid checkout directory")
		}
	}
	content, err := root.OpenRoot("content")
	if err != nil {
		return 0, err
	}
	defer content.Close()
	snapshot, err := (&web.ContentStore{Build: i.Build}).LoadRoot(content)
	if err != nil {
		return 0, err
	}
	if err = conn.QueryRow(ctx, `SELECT nextval('release_revision_seq')`).Scan(&revision); err != nil {
		return 0, err
	}
	public, err := root.OpenRoot("public")
	if err != nil {
		return 0, err
	}
	defer public.Close()
	info, err := public.Lstat("_redirects")
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, fmt.Errorf("redirects must be regular file")
	}
	rules, err := public.ReadFile("_redirects")
	if err != nil {
		return 0, err
	}
	if _, err = (&web.Static{}).WithRedirects(string(rules)); err != nil {
		return 0, err
	}
	phase = "media_failed"
	snapshot, manifest, err := i.media(ctx, public, revision, snapshot)
	if err != nil {
		return 0, err
	}
	snapshot.Redirects = string(rules)
	phase = "index_failed"
	collections, err := i.Typesense.Index(ctx, revision, snapshot.Documents)
	if err != nil {
		return 0, err
	}
	// Search is owned exclusively by Typesense after publication.
	snapshot.Documents = nil
	data, err := json.Marshal(snapshot)
	if err != nil {
		return 0, err
	}
	indices, _ := json.Marshal(collections)
	media, _ := json.Marshal(manifest)
	phase = "commit_failed"
	tx, err := conn.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `INSERT INTO releases(revision,source_sha,snapshot,search_collections,media_manifest) VALUES($1,$2,$3,$4,$5)`, revision, sha, data, indices, media); err != nil {
		return 0, err
	}
	if _, err = tx.Exec(ctx, `UPDATE publication SET active_revision=$1,phase='ready',error_code='',updated_at=now() WHERE id=1`, revision); err != nil {
		return 0, err
	}
	err = tx.Commit(ctx)
	return revision, err
}
