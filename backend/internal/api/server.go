package api

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/openrewrite/studio/backend/internal/domain"
	"github.com/openrewrite/studio/backend/internal/repository"
	"github.com/openrewrite/studio/backend/internal/service"
)

// contextKey is a typed key for values stored in request context.
type contextKey int

const (
	contextKeyRequestID contextKey = iota
)

// Server holds all dependencies for the HTTP API.
type Server struct {
	rewriteService *service.RewriteService
	store          *repository.MemoryStore
	logger         *slog.Logger
	limiter        *rateLimiter
	allowedOrigins []string
	cancel         context.CancelFunc
}

// NewServer creates a new Server and starts the rate-limiter cleanup goroutine.
// The cleanup goroutine runs until the returned Server is shut down via Start or
// until the process exits.
func NewServer(rewriteService *service.RewriteService, store *repository.MemoryStore, logger *slog.Logger) *Server {
	ctx, cancel := context.WithCancel(context.Background())

	origins := []string{"http://localhost:3000", "http://127.0.0.1:3000"}
	if frontendURL := strings.TrimSpace(os.Getenv("FRONTEND_URL")); frontendURL != "" {
		origins = append(origins, frontendURL)
	}

	limiter := newRateLimiter(120, time.Minute)

	server := &Server{
		rewriteService: rewriteService,
		store:          store,
		logger:         logger,
		limiter:        limiter,
		allowedOrigins: origins,
		cancel:         cancel,
	}

	go limiter.cleanup(ctx, 5*time.Minute)

	return server
}

// Routes builds and returns the chi router with all middleware and route
// registrations. Middleware order: CORS -> RequestID -> RequestLog -> RateLimit.
func (server *Server) Routes() http.Handler {
	router := chi.NewRouter()
	router.Use(server.withCORS)
	router.Use(server.withRequestID)
	router.Use(server.withRequestLog)
	router.Use(server.withRateLimit)
	router.Get("/health", server.health)
	router.Get("/metrics", server.metrics)
	router.Route("/v1", func(router chi.Router) {
		router.Post("/rewrite", server.rewrite)
		router.Post("/rewrite/stream", server.rewrite)
		router.Get("/rewrite-sessions", server.listSessions)
		router.Get("/rewrite-sessions/{id}", server.getSession)
		router.Post("/rewrite-sessions/{id}/accept", server.acceptSession)
		router.Get("/presets", server.listPresets)
		router.Post("/presets", server.createPreset)
		router.Patch("/presets/{id}", server.updatePreset)
		router.Delete("/presets/{id}", server.deletePreset)
		router.Post("/evaluate", server.evaluate)
		router.Post("/api-keys", server.createAPIKey)
		router.Delete("/api-keys/{id}", server.deleteAPIKey)
		router.Get("/admin/usage", server.usage)
	})
	return router
}

// Start binds the HTTP server on addr and blocks until SIGINT or SIGTERM is
// received, then performs a graceful shutdown with a 30-second timeout.
func (server *Server) Start(addr string) error {
	srv := &http.Server{
		Addr:    addr,
		Handler: server.Routes(),
	}

	errCh := make(chan error, 1)
	go func() {
		server.logger.Info("server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		server.cancel()
		return err
	case sig := <-quit:
		server.logger.Info("shutdown signal received", "signal", sig.String())
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	server.cancel() // stop background goroutines
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown failed: %w", err)
	}
	server.logger.Info("server stopped gracefully")
	return nil
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

func (server *Server) health(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *Server) metrics(writer http.ResponseWriter, request *http.Request) {
	usage := server.store.UsageSummary()
	writer.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = writer.Write([]byte(
		"# HELP openrewrite_rewrite_count Total rewrites in the current process.\n" +
			"# TYPE openrewrite_rewrite_count counter\n" +
			"openrewrite_rewrite_count " + formatFloat(float64(usage.RewriteCount)) + "\n" +
			"# HELP openrewrite_meaning_score Average meaning preservation score.\n" +
			"# TYPE openrewrite_meaning_score gauge\n" +
			"openrewrite_meaning_score " + formatFloat(usage.AverageMeaningScore) + "\n",
	))
}

func (server *Server) rewrite(writer http.ResponseWriter, request *http.Request) {
	var payload domain.RewriteRequest
	if !decodeJSON(writer, request, &payload) {
		return
	}
	session, err := server.rewriteService.Rewrite(request.Context(), payload)
	if err != nil {
		server.logger.Warn("rewrite failed", "error", err, "request_id", requestIDFromCtx(request.Context()))
		writeError(writer, http.StatusBadRequest, "REWRITE_FAILED", err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, session)
}

func (server *Server) listSessions(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, server.store.ListSessions())
}

func (server *Server) getSession(writer http.ResponseWriter, request *http.Request) {
	session, err := server.store.GetSession(chi.URLParam(request, "id"))
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, session)
}

func (server *Server) acceptSession(writer http.ResponseWriter, request *http.Request) {
	session, err := server.store.AcceptSession(chi.URLParam(request, "id"))
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, session)
}

func (server *Server) listPresets(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, server.store.ListPresets())
}

func (server *Server) createPreset(writer http.ResponseWriter, request *http.Request) {
	var preset domain.Preset
	if !decodeJSON(writer, request, &preset) {
		return
	}
	if strings.TrimSpace(preset.Name) == "" {
		writeError(writer, http.StatusBadRequest, "VALIDATION_ERROR", "preset name is required")
		return
	}
	writeJSON(writer, http.StatusCreated, server.store.SavePreset(preset))
}

func (server *Server) updatePreset(writer http.ResponseWriter, request *http.Request) {
	var preset domain.Preset
	if !decodeJSON(writer, request, &preset) {
		return
	}
	preset.ID = chi.URLParam(request, "id")
	writeJSON(writer, http.StatusOK, server.store.SavePreset(preset))
}

func (server *Server) deletePreset(writer http.ResponseWriter, request *http.Request) {
	if err := server.store.DeletePreset(chi.URLParam(request, "id")); err != nil {
		writeDomainError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) evaluate(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		OriginalText  string `json:"originalText"`
		RewrittenText string `json:"rewrittenText"`
		MeaningLock   bool   `json:"meaningLock"`
	}
	if !decodeJSON(writer, request, &payload) {
		return
	}
	evaluation, err := server.rewriteService.Evaluate(request.Context(), payload.OriginalText, payload.RewrittenText, payload.MeaningLock)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "EVALUATION_FAILED", err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, evaluation)
}

func (server *Server) createAPIKey(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		Name string `json:"name"`
	}
	if !decodeJSON(writer, request, &payload) {
		return
	}
	if strings.TrimSpace(payload.Name) == "" {
		writeError(writer, http.StatusBadRequest, "VALIDATION_ERROR", "api key name is required")
		return
	}
	writeJSON(writer, http.StatusCreated, server.store.CreateAPIKey(payload.Name))
}

func (server *Server) deleteAPIKey(writer http.ResponseWriter, request *http.Request) {
	if err := server.store.DeleteAPIKey(chi.URLParam(request, "id")); err != nil {
		writeDomainError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) usage(writer http.ResponseWriter, request *http.Request) {
	writeJSON(writer, http.StatusOK, server.store.UsageSummary())
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// withCORS handles cross-origin requests. Allowed origins include localhost:3000
// and the value of FRONTEND_URL (if set).
func (server *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		origin := request.Header.Get("Origin")
		allowed := server.isAllowedOrigin(origin)

		if allowed {
			writer.Header().Set("Access-Control-Allow-Origin", origin)
			writer.Header().Add("Vary", "Origin")
		}
		writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
		writer.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Request-ID")

		if request.Method == http.MethodOptions {
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

// withRequestID extracts the X-Request-ID header (or generates a new one),
// stores it in the context, and echoes it back in the response header.
func (server *Server) withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		id := strings.TrimSpace(request.Header.Get("X-Request-ID"))
		if id == "" {
			id = newRequestID()
		}
		ctx := context.WithValue(request.Context(), contextKeyRequestID, id)
		writer.Header().Set("X-Request-ID", id)
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

// withRequestLog logs method, path, status code, duration, and remote IP for
// every request. It wraps the ResponseWriter to capture the status code.
func (server *Server) withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		startedAt := time.Now()
		rw := &responseWriter{ResponseWriter: writer, status: http.StatusOK}
		next.ServeHTTP(rw, request)
		server.logger.Info("request",
			"request_id", requestIDFromCtx(request.Context()),
			"method", request.Method,
			"path", request.URL.Path,
			"status", rw.status,
			"duration_ms", time.Since(startedAt).Milliseconds(),
			"remote_ip", clientIP(request),
		)
	})
}

// withRateLimit rejects requests that exceed the per-IP rate limit.
func (server *Server) withRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !server.limiter.allow(clientIP(request)) {
			writeError(writer, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please slow down.")
			return
		}
		next.ServeHTTP(writer, request)
	})
}

// ---------------------------------------------------------------------------
// responseWriter wrapper – captures status code for logging
// ---------------------------------------------------------------------------

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------

func (server *Server) isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	for _, allowed := range server.allowedOrigins {
		if allowed == origin {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]bucket
}

type bucket struct {
	count    int
	resetAt  time.Time
	lastSeen time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, buckets: make(map[string]bucket)}
}

// allow returns true when the key is within the rate limit for the current window.
func (limiter *rateLimiter) allow(key string) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := time.Now()
	item := limiter.buckets[key]
	if now.After(item.resetAt) {
		item = bucket{resetAt: now.Add(limiter.window)}
	}
	item.count++
	item.lastSeen = now
	limiter.buckets[key] = item
	return item.count <= limiter.limit
}

// cleanup removes stale buckets every interval until ctx is cancelled.
// A bucket is stale when lastSeen is older than the limiter window, meaning
// the IP has not sent any request for at least one full window.
func (limiter *rateLimiter) cleanup(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			limiter.mu.Lock()
			cutoff := time.Now().Add(-limiter.window)
			for key, item := range limiter.buckets {
				if item.lastSeen.Before(cutoff) {
					delete(limiter.buckets, key)
				}
			}
			limiter.mu.Unlock()
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func clientIP(request *http.Request) string {
	if forwarded := request.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return request.RemoteAddr
	}
	return host
}

// newRequestID returns a random 16-byte hex string suitable for use as a
// request identifier. Falls back to a timestamp-based ID if crypto/rand fails.
func newRequestID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", buf)
}

func requestIDFromCtx(ctx context.Context) string {
	if id, ok := ctx.Value(contextKeyRequestID).(string); ok {
		return id
	}
	return ""
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, target any) bool {
	defer request.Body.Close()
	if err := json.NewDecoder(request.Body).Decode(target); err != nil {
		writeError(writer, http.StatusBadRequest, "VALIDATION_ERROR", "invalid JSON body")
		return false
	}
	return true
}

func writeDomainError(writer http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrNotFound) {
		writeError(writer, http.StatusNotFound, "NOT_FOUND", "resource not found")
		return
	}
	writeError(writer, http.StatusInternalServerError, "INTERNAL_ERROR", "request failed")
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, status int, code string, message string) {
	writeJSON(writer, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
