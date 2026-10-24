package web

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMediaCSPUsesOnlyConfiguredOrigin(t *testing.T) {
	t.Setenv("MEDIA_BASE_URL", "http://127.0.0.1:45104/blog-test-media")
	w := httptest.NewRecorder()
	securityHeaders(w)
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "img-src 'self' blob: data: http://127.0.0.1:45104;") || !strings.Contains(csp, "media-src 'self' http://127.0.0.1:45104;") {
		t.Fatal(csp)
	}
	if strings.Contains(csp, "blog-test-media") || strings.Contains(csp, "*") {
		t.Fatal(csp)
	}
	t.Setenv("MEDIA_BASE_URL", "javascript:alert(1)")
	w = httptest.NewRecorder()
	securityHeaders(w)
	if strings.Contains(w.Header().Get("Content-Security-Policy"), "javascript") {
		t.Fatal(w.Header())
	}
}
