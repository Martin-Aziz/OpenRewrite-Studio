package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/openrewrite/studio/backend/internal/domain"
)

type AIClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewAIClient(baseURL string, httpClient *http.Client) *AIClient {
	return &AIClient{baseURL: baseURL, httpClient: httpClient}
}

func (client *AIClient) Rewrite(ctx context.Context, request domain.RewriteRequest) (domain.AIRewriteResponse, error) {
	return postAI[domain.AIRewriteResponse](ctx, client, "/rewrite", request)
}

func (client *AIClient) Evaluate(ctx context.Context, payload map[string]any) (domain.RewriteEvaluation, error) {
	return postAI[domain.RewriteEvaluation](ctx, client, "/evaluate", payload)
}

func postAI[TResponse any](ctx context.Context, client *AIClient, path string, payload any) (TResponse, error) {
	var result TResponse
	body, err := json.Marshal(payload)
	if err != nil {
		return result, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return result, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		return result, fmt.Errorf("ai service returned %d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return result, err
	}
	return result, nil
}

func RequestContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 55*time.Second)
}
