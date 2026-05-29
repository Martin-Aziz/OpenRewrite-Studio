# ADR 0002: Model Provider Abstraction

## Status

Accepted

## Context

Users need the product to run with no paid key, with hosted LLM APIs, and with local/self-hosted models.

## Decision

The AI service exposes a stable rewrite/evaluation contract and routes through provider adapters for local deterministic rewriting, OpenAI-compatible APIs, and Ollama-compatible local models.

## Consequences

The UI and API do not care which model generated the result. Provider-specific errors are contained inside the AI service and surfaced as structured gateway failures.
