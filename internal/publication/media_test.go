package publication

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProjectionRemovesSourceAndRetainsDocumentNodes(t *testing.T) {
	input := map[string]any{"post": map[string]any{"_raw": map[string]any{"sourceFilePath": "secret.md"}, "body": map[string]any{"raw": "private source"}, "draft": false, "title": "public"}, "body": []any{map[string]any{"tag": "p", "children": []any{"Public"}}}}
	data, err := json.Marshal(scrub(input))
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err = json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	post := result["post"].(map[string]any)
	for _, key := range []string{"_raw", "draft"} {
		if _, ok := post[key]; ok {
			t.Fatal(key)
		}
	}
	if _, ok := post["body"].(map[string]any)["raw"]; ok {
		t.Fatal("raw")
	}
	if len(result["body"].([]any)) != 1 {
		t.Fatal(result)
	}
}

func TestMediaProjectionUsesOneReleaseAcrossFieldsAndPreservesCode(t *testing.T) {
	input := map[string]any{
		"post":      map[string]any{"image": "https://zaixi.dev/static/images/cover.webp"},
		"metadata":  map[string]any{"image": "https://zaixi.dev/static/images/cover.webp", "jsonLd": map[string]any{"@type": "ImageObject", "url": "https://zaixi.dev/static/images/cover.webp"}},
		"documents": []any{map[string]any{"image": "/static/images/cover.webp", "url": "/zh/article/"}},
		"body":      []any{map[string]any{"tag": "img", "props": map[string]any{"src": "https://zaixi.dev/static/images/cover.webp"}}, map[string]any{"tag": "code", "children": []any{"![literal](/static/images/code.webp)"}}},
		"export":    "![cover](https://zaixi.dev/static/images/cover.webp)\n<img src=\"https://zaixi.dev/static/images/cover.webp\">\n`![literal](/static/images/inline.webp)`\n```md\n![literal](/static/images/code.webp)\n```\nhttps://outside.test/static/images/cover.webp",
	}
	paths := map[string]bool{}
	referencedMedia(input, paths)
	if len(paths) != 1 || !paths["/static/images/cover.webp"] {
		t.Fatal(paths)
	}
	target := "https://blog-media.zaixi.dev/releases/42/static/images/cover.webp"
	output := projectMedia(input, "", func(source string) string {
		if mediaPath(source) == "/static/images/cover.webp" {
			return target
		}
		return source
	}).(map[string]any)
	for _, value := range []any{output["post"].(map[string]any)["image"], output["metadata"].(map[string]any)["image"], output["metadata"].(map[string]any)["jsonLd"].(map[string]any)["url"], output["documents"].([]any)[0].(map[string]any)["image"], output["body"].([]any)[0].(map[string]any)["props"].(map[string]any)["src"]} {
		if value != target {
			t.Fatal(value)
		}
	}
	export := output["export"].(string)
	if strings.Count(export, target) != 2 || !strings.Contains(export, "`![literal](/static/images/inline.webp)`") || !strings.Contains(export, "https://outside.test/static/images/cover.webp") {
		t.Fatal(export)
	}
	if output["documents"].([]any)[0].(map[string]any)["url"] != "/zh/article/" {
		t.Fatal(output)
	}
}

func TestMediaReferencesExcludeEscapedMarkupDelimiters(t *testing.T) {
	input := `{"html":"<img src=\"/static/images/a.webp\" />","src":"/forum/b.webp"}`
	var value any
	if err := json.Unmarshal([]byte(input), &value); err != nil {
		t.Fatal(err)
	}
	paths := map[string]bool{}
	referencedMedia(value, paths)
	if len(paths) != 2 || !paths["/static/images/a.webp"] || !paths["/forum/b.webp"] {
		t.Fatal(paths)
	}
}
