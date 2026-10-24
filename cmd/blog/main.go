package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"zaixi.blog/server/internal/publication"
	"zaixi.blog/server/internal/web"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", "127.0.0.1:45101", "HTTP bind address; occupied ports fail")
	staticDir := flag.String("static", "out", "static application directory")
	contentDir := flag.String("content", "content", "mounted content directory")
	mediaDir := flag.String("media", "public", "mounted public directory containing static/")
	checkoutRoot := flag.String("checkout-root", "", "import source checkout containing content/ and public/")
	workerScript := flag.String("worker", "dist/worker/content-worker.mjs", "private Node stdio worker")
	mode := flag.String("mode", "serve", "serve, migrate or import")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *mode == "init-local-media" {
		return publication.ImporterFromEnv(nil).InitializeLocalBucket(ctx)
	}
	if *mode == "migrate" {
		conn, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))
		if err != nil {
			return err
		}
		defer conn.Close(ctx)
		_, err = conn.Exec(ctx, publication.Schema)
		return err
	}
	var static *web.Static
	var err error
	if *mode == "serve" {
		static, err = web.NewStatic(*staticDir, nil)
		if err != nil {
			return err
		}
		defer static.Root.Close()
	}
	var handler http.Handler
	if os.Getenv("DATABASE_URL") != "" && *mode == "serve" {
		handler = publication.FromEnv(static)
	} else {
		workerContext, cancelWorker := context.WithCancel(context.Background())
		defer cancelWorker()
		worker, err := web.StartWorker(workerContext, "node", *workerScript)
		if err != nil {
			return err
		}
		defer func() {
			cancelWorker()
			if err := worker.Close(); err != nil && ctx.Err() == nil {
				log.Print(err)
			}
		}()
		store := &web.ContentStore{Directory: *contentDir, Build: worker.Build}
		if *mode == "import" {
			if *checkoutRoot == "" {
				return fmt.Errorf("import requires --checkout-root")
			}
			pinned, err := filepath.EvalSymlinks(*checkoutRoot)
			if err != nil {
				return err
			}
			shaBytes, err := exec.Command("git", "-C", pinned, "rev-parse", "HEAD").Output()
			if err != nil {
				return err
			}
			sha := strings.TrimSpace(string(shaBytes))
			revision, err := publication.ImporterFromEnv(worker.Build).Import(ctx, pinned, sha)
			if err == nil {
				log.Printf("Published revision %d source %s", revision, sha)
			}
			return err
		}
		if *mode != "serve" {
			return fmt.Errorf("unknown mode")
		}
		if _, err := store.Load(); err != nil {
			return err
		}
		mediaRoot, err := os.OpenRoot(*mediaDir)
		if err != nil {
			return err
		}
		defer mediaRoot.Close()
		media := &web.Static{Root: mediaRoot}
		legacy := &web.Handler{Content: store, Static: static, Media: media}
		handler = legacy
		static.Shell = legacy.Shell
		static.PageExists = func(p string) bool { return true }
	}
	handler = web.CORS(handler, os.Getenv("CORS_ORIGINS"))
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			log.Print(err)
		}
	}()
	log.Printf("Blog listening on http://%s", listener.Addr())
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-shutdownDone
	return nil
}
