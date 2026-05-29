# Technical Debt

| Priority | Item | Impact | Planned Resolution |
| --- | --- | --- | --- |
| High | API persistence currently defaults to memory | History resets on restart outside Docker/PostgreSQL implementation | Add `PostgresRewriteRepository` using the existing migration schema. |
| High | AI evaluation uses lexical similarity | It catches obvious drift but misses deeper entailment issues | Add pgvector embeddings and NLI evaluator behind the same `EvaluationResult` contract. |
| Medium | Streaming endpoint is documented but not separately implemented | Long generations cannot stream token-by-token yet | Add SSE support in Go API and provider clients. |
| Medium | Auth is scaffolded in schema/docs but not enforced in local MVP | Multi-user hosted mode requires JWT/session hardening | Add OIDC/JWT middleware with refresh rotation and RBAC checks. |
| Low | No browser extension package yet | Rewriting outside the app is future-phase | Add extension workspace after web/API contracts settle. |
