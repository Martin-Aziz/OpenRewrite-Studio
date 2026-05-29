# Implementation Decisions & Assumptions

## Assumptions Made

1. No external model key is guaranteed during first run, so the AI service defaults to a deterministic local provider. If this assumption is wrong, set `AI_PROVIDER=openai-compatible` or `AI_PROVIDER=ollama` and configure the endpoint variables in `.env`.
2. The first MVP should prioritize a truthful vertical slice over breadth. Browser extension, desktop shortcut, billing, and SSO are documented future work rather than non-functional shells.
3. Account and workspace data need a production schema, but local development should work without provisioning PostgreSQL. The Go API therefore uses an in-memory repository by default and ships SQL migrations for hosted/self-hosted deployments.
4. The ethical boundary is product-defining: copy uses "natural", "clarity", and "meaning preservation" language and avoids "bypass detector" positioning.

## Technology Choices

| Decision | Alternatives Considered | Rationale | Migration Path |
| --- | --- | --- | --- |
| AGPL-3.0-only | MIT, Apache-2.0 | Protects open hosted modifications while allowing self-hosting and community contribution. | Re-license only with contributor agreement and explicit project governance. |
| Go + Chi API | Rust Axum, Node Express | Small, fast, typed API with simple deployment and clean HTTP primitives. | Keep OpenAPI stable and replace handlers behind the same contracts. |
| Python FastAPI AI service | Go-only AI orchestration | Python has stronger AI/client ecosystem and fast iteration for evaluation logic. | Provider interface isolates model clients. |
| Next.js + Tailwind + shadcn-style components | Vite SPA, Remix | App Router supports product pages and app screens in one codebase. | UI state is isolated in components and hooks. |
| Deterministic local rewrite provider | Mock-only responses | The app must actually transform text without paid infrastructure. | External providers can be enabled through environment variables. |
| Tauri desktop shell | Browser-only, separate native app | Keeps the browser app as the source of truth while enabling native install and future global shortcuts. | Add tray/shortcut plugins without changing the web contracts. |

## Deviations

- The MVP includes an in-memory repository for immediate local use. This is intentional for tracer-bullet development and backed by versioned PostgreSQL migrations.
- Real-time streaming is represented by a responsive request flow in the frontend and reserved as a backend enhancement in `TECHNICAL_DEBT.md`.

## Known Technical Debt

1. High: PostgreSQL repository implementation should replace in-memory storage for hosted mode.
2. Medium: Semantic similarity should move from lexical overlap to embeddings plus NLI-style entailment.
3. Medium: `/v1/rewrite/stream` should use server-sent events once provider streaming is enabled.
4. Low: Add browser extension and desktop shortcut after rewrite quality is validated by real users.
