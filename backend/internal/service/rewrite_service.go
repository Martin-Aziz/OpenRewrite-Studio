package service

import (
	"context"
	"html"
	"log/slog"
	"strings"
	"time"

	"github.com/openrewrite/studio/backend/internal/domain"
	"github.com/openrewrite/studio/backend/internal/repository"
)

const maxInputRunes = 12000

type RewriteService struct {
	aiClient *AIClient
	store    *repository.MemoryStore
}

func NewRewriteService(aiClient *AIClient, store *repository.MemoryStore) *RewriteService {
	return &RewriteService{aiClient: aiClient, store: store}
}

// sanitize trims whitespace, escapes HTML/script injection characters, and
// truncates the input to maxInputRunes runes to match validation limits.
func sanitize(text string) string {
	text = strings.TrimSpace(text)
	text = html.EscapeString(text)
	runes := []rune(text)
	if len(runes) > maxInputRunes {
		runes = runes[:maxInputRunes]
	}
	return string(runes)
}

func (service *RewriteService) Rewrite(ctx context.Context, request domain.RewriteRequest) (domain.RewriteSession, error) {
	if err := request.Validate(); err != nil {
		return domain.RewriteSession{}, err
	}

	request.Text = sanitize(request.Text)

	startedAt := time.Now()
	requestCtx, cancel := RequestContext(ctx)
	defer cancel()

	aiResponse, err := service.aiClient.Rewrite(requestCtx, request)
	if err != nil {
		return domain.RewriteSession{}, err
	}

	session := domain.RewriteSession{
		SessionID:     repository.NewID("rw"),
		OriginalText:  request.Text,
		RewrittenText: aiResponse.RewrittenText,
		Mode:          request.Mode,
		Tone:          request.Tone,
		Strength:      request.Strength,
		Provider:      aiResponse.Provider,
		Diffs:         aiResponse.Diffs,
		Evaluation:    aiResponse.Evaluation,
		CreatedAt:     time.Now().UTC(),
		LatencyMS:     time.Since(startedAt).Milliseconds(),
	}

	slog.Info("rewrite completed",
		"session_id", session.SessionID,
		"mode", session.Mode,
		"tone", session.Tone,
		"provider", session.Provider,
		"duration_ms", session.LatencyMS,
	)

	// Persist the session asynchronously so the caller is not blocked by
	// storage latency. A dedicated timeout prevents the goroutine from
	// leaking if the store hangs.
	go func() {
		saveCtx, saveCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer saveCancel()
		_ = saveCtx // MemoryStore.SaveSession is in-memory and does not accept a context;
		// the timeout guards against any future blocking store implementation.
		if s := service.store.SaveSession(session); s.SessionID == "" {
			slog.Error("failed to persist session", "session_id", session.SessionID)
		}
	}()

	return session, nil
}

func (service *RewriteService) Evaluate(ctx context.Context, originalText string, rewrittenText string, meaningLock bool) (domain.RewriteEvaluation, error) {
	requestCtx, cancel := RequestContext(ctx)
	defer cancel()
	return service.aiClient.Evaluate(requestCtx, map[string]any{
		"originalText":  originalText,
		"rewrittenText": rewrittenText,
		"meaningLock":   meaningLock,
	})
}
