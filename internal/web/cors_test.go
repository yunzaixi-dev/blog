package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCORS(t *testing.T) {
	h := CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "unavailable", 503) }), "https://zaixi.dev,https://dev.zaixi.dev")
	for _, tc := range []struct {
		origin, method, requested, headers string
		status                             int
		allow                              bool
	}{
		{"", "GET", "", "", 503, false},
		{"https://zaixi.dev", "GET", "", "", 503, true},
		{"https://dev.zaixi.dev", "HEAD", "", "", 503, true},
		{"https://evil.zaixi.dev", "GET", "", "", 403, false},
		{"https://zaixi.dev.evil.test", "GET", "", "", 403, false},
		{"null", "GET", "", "", 403, false},
		{"https://zaixi.dev", "OPTIONS", "GET", "", 204, true},
		{"https://zaixi.dev", "OPTIONS", "POST", "", 403, true},
		{"https://zaixi.dev", "OPTIONS", "GET", "authorization", 403, true},
	} {
		r := httptest.NewRequest(tc.method, "/api/page", nil)
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Access-Control-Request-Method", tc.requested)
		r.Header.Set("Access-Control-Request-Headers", tc.headers)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%+v: %d", tc, w.Code)
		}
		if (w.Header().Get("Access-Control-Allow-Origin") != "") != tc.allow {
			t.Fatalf("%+v: %v", tc, w.Header())
		}
		if w.Header().Get("Access-Control-Allow-Credentials") != "" || !strings.Contains(w.Header().Get("Vary"), "Origin") {
			t.Fatal(w.Header())
		}
	}
}
