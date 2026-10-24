package web

import (
	"net/http"
	"strings"
)

// CORS accepts only configured exact origins. No browser credentials are needed.
func CORS(next http.Handler, origins string) http.Handler {
	allowed := map[string]bool{}
	for _, origin := range strings.Split(origins, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = true
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		securityHeaders(w)
		w.Header().Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		if origin != "" {
			scheme := "http"
			if r.TLS != nil {
				scheme = "https"
			}
			if !allowed[origin] && origin != scheme+"://"+r.Host {
				jsonResponse(w, http.StatusForbidden, map[string]string{"error": "origin not allowed"})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		if r.Method == http.MethodOptions {
			w.Header().Add("Vary", "Access-Control-Request-Method")
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			method := r.Header.Get("Access-Control-Request-Method")
			if origin == "" || (method != http.MethodGet && method != http.MethodHead) || r.Header.Get("Access-Control-Request-Headers") != "" {
				jsonResponse(w, http.StatusForbidden, map[string]string{"error": "preflight not allowed"})
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
