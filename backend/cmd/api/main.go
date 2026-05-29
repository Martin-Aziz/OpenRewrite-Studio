package main

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/openrewrite/studio/backend/internal/api"
	"github.com/openrewrite/studio/backend/internal/config"
	"github.com/openrewrite/studio/backend/internal/repository"
	"github.com/openrewrite/studio/backend/internal/service"
)

func main() {
	cfg := config.Load()
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		runHealthcheck(cfg.Port)
		return
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	store := repository.NewMemoryStore()
	aiClient := service.NewAIClient(cfg.AIServiceURL, http.DefaultClient)
	rewriteService := service.NewRewriteService(aiClient, store)
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.NewServer(rewriteService, store, logger).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("api server starting", "port", cfg.Port, "aiServiceUrl", cfg.AIServiceURL)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("api server failed", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("api shutdown failed", "error", err)
	}
}

func runHealthcheck(port string) {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, 2*time.Second)
	if err != nil {
		os.Exit(1)
	}
	_ = conn.Close()
}
