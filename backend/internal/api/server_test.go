package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/openrewrite/studio/backend/internal/domain"
	"github.com/openrewrite/studio/backend/internal/repository"
	"github.com/openrewrite/studio/backend/internal/service"
)

type stubAITransport struct{}

func (transport stubAITransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response := domain.AIRewriteResponse{
		RewrittenText: "Our team will use this writing process.",
		Provider:      "local",
		Diffs: []domain.SentenceDiff{{
			Index:       0,
			Original:    "It is important to note that our team will utilize this writing workflow.",
			Rewritten:   "Our team will use this writing process.",
			ChangeRatio: 0.42,
			Status:      "changed",
		}},
		Evaluation: domain.RewriteEvaluation{
			MeaningScore:       0.86,
			ConfidenceScore:    0.91,
			FactsPreserved:     true,
			CitationsPreserved: true,
			Warnings:           []domain.RewriteWarning{},
		},
	}
	body, _ := json.Marshal(response)
	return &http.Response{StatusCode: http.StatusOK, Body: ioNopCloser{bytes.NewReader(body)}, Header: make(http.Header)}, nil
}

func TestRewriteEndpointCreatesSession(t *testing.T) {
	server := testServer()
	payload := []byte(`{"text":"It is important to note that our team will utilize this writing workflow.","mode":"natural","tone":"warm","strength":60,"meaningLock":true,"provider":"local"}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/rewrite", bytes.NewReader(payload))
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	var session domain.RewriteSession
	if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.SessionID == "" {
		t.Fatal("expected session id")
	}
}

func TestRewriteEndpointRejectsInvalidMode(t *testing.T) {
	server := testServer()
	payload := []byte(`{"text":"hello","mode":"bad","tone":"warm","strength":60,"meaningLock":true,"provider":"local"}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/rewrite", bytes.NewReader(payload))
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func testServer() http.Handler {
	store := repository.NewMemoryStore()
	httpClient := &http.Client{Transport: stubAITransport{}}
	aiClient := service.NewAIClient("http://ai-service", httpClient)
	rewriteService := service.NewRewriteService(aiClient, store)
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	return NewServer(rewriteService, store, logger).Routes()
}

type ioNopCloser struct {
	*bytes.Reader
}

func (closer ioNopCloser) Close() error {
	return nil
}

var _ = context.Background
