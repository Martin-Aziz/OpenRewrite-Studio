package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/openrewrite/studio/backend/internal/domain"
	"github.com/openrewrite/studio/backend/internal/repository"
	"github.com/openrewrite/studio/backend/internal/service"
)

type Server struct {
	rewriteService *service.RewriteService
	store          *repository.MemoryStore
	logger         *slog.Logger
	limiter        *rateLimiter
}

func NewServer(rewriteService *service.RewriteService, store *repository.MemoryStore, logger *slog.Logger) *Server {
	return &Server{rewriteService: rewriteService, store: store, logger: logger, limiter: newRateLimiter(120, time.Minute)}
}

func (server *Server) Routes() http.Handler {
	router := chi.NewRouter()
	router.Use(server.withCORS)
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
		server.logger.Warn("rewrite failed", "error", err)
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

func (server *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Access-Control-Allow-Origin", "*")
		writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
		writer.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if request.Method == http.MethodOptions {
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func (server *Server) withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		startedAt := time.Now()
		next.ServeHTTP(writer, request)
		server.logger.Info("request", "method", request.Method, "path", request.URL.Path, "durationMs", time.Since(startedAt).Milliseconds())
	})
}

func (server *Server) withRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !server.limiter.allow(clientIP(request)) {
			writeError(writer, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please slow down.")
			return
		}
		next.ServeHTTP(writer, request)
	})
}

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

type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]bucket
}

type bucket struct {
	count   int
	resetAt time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, buckets: make(map[string]bucket)}
}

func (limiter *rateLimiter) allow(key string) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := time.Now()
	item := limiter.buckets[key]
	if now.After(item.resetAt) {
		item = bucket{resetAt: now.Add(limiter.window)}
	}
	item.count++
	limiter.buckets[key] = item
	return item.count <= limiter.limit
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
