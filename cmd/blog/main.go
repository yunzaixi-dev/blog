package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	workerScript := flag.String("worker", "dist/worker/content-worker.mjs", "private Node stdio worker")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
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
	if _, err := store.Load(); err != nil {
		return err
	}
	static, err := web.NewStatic(*staticDir, nil)
	if err != nil {
		return err
	}
	defer static.Root.Close()
	mediaRoot, err := os.OpenRoot(*mediaDir)
	if err != nil {
		return err
	}
	defer mediaRoot.Close()
	media := &web.Static{Root: mediaRoot}
	handler := &web.Handler{Content: store, Static: static, Media: media}
	static.Shell = handler.Shell
	static.PageExists = func(p string) bool { return true }
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
