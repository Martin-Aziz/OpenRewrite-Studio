package service

import (
	"context"
	"strings"
	"time"

	"github.com/openrewrite/studio/backend/internal/domain"
	"github.com/openrewrite/studio/backend/internal/repository"
)

type RewriteService struct {
	aiClient *AIClient
	store    *repository.MemoryStore
}

func NewRewriteService(aiClient *AIClient, store *repository.MemoryStore) *RewriteService {
	return &RewriteService{aiClient: aiClient, store: store}
}

func (service *RewriteService) Rewrite(ctx context.Context, request domain.RewriteRequest) (domain.RewriteSession, error) {
	if err := request.Validate(); err != nil {
		return domain.RewriteSession{}, err
	}
	request.Text = strings.TrimSpace(request.Text)
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
	return service.store.SaveSession(session), nil
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
