# Claude Opus — OpenRewrite Studio: Full-Stack Excellence Prompt

> **Goal:** Transform OpenRewrite Studio from a strong MVP into a best-in-class writing transformation tool that surpasses QuillBot in rewrite quality, responsiveness, user trust, and developer correctness. Work file by file, fixing everything: algorithms, performance, UX, security, correctness, and architecture.

---

## Your Role

You are a world-class full-stack engineer with deep expertise in:
- Python NLP/ML (spaCy, sentence-transformers, NLTK, scikit-learn)
- Go backend engineering (performance, concurrency, security)
- React/Next.js frontend performance and UX
- System architecture and production readiness

You have access to the complete OpenRewrite Studio codebase. Your job is to go **file by file** and make every piece of it exceptional. Do not skip any file. Do not leave partial work. Every change must be complete, tested, and production-quality.

---

## Project Context

**What it is:** A privacy-first, self-hostable text rewriting assistant with 9 modes (fluency, professional, simple, shorten, expand, natural, humanize, academic, standard), 6 tone variants, and a meaning-lock safety system. It competes directly with QuillBot.

**Current state:** Well-architected MVP with clean separation across Next.js frontend → Go Chi API → Python FastAPI AI service → PostgreSQL (schema ready, not yet wired up). The local deterministic rewrite engine needs a major algorithm upgrade. Many production-readiness gaps remain.

**Stack:**
- Frontend: Next.js 16, React 19, Tailwind CSS, Zustand, TanStack Query, Framer Motion
- Backend API: Go 1.25, Chi v5, in-memory repository (PostgreSQL schema exists but not implemented)
- AI Service: Python 3, FastAPI, Pydantic v2, httpx
- Infrastructure: Docker Compose, nginx, PostgreSQL 16, Redis 7
- Desktop: Tauri shell

---

## Files to Work Through (in order of impact)

### TIER 1 — Core Algorithm (Highest Impact)

---

### 1. `ai-service/app/rewrite_engine.py`

This is the heart of the product. The current implementation is a naive dictionary replacement engine. Replace and extend it completely.

**Sentence Splitting — Replace regex with NLTK:**
```python
# CURRENT (fragile):
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
sentences = SENTENCE_SPLIT.split(text)

# REPLACE WITH:
import nltk
nltk.download("punkt", quiet=True)
from nltk.tokenize import sent_tokenize
sentences = sent_tokenize(text)
```
Why: The current regex breaks on abbreviations ("Dr. Smith"), ellipsis, parenthetical sentences, and Unicode punctuation. `sent_tokenize` handles all of these.

**Semantic Similarity — Replace lexical overlap with sentence-transformers:**
```python
# CURRENT: basic token set intersection (misses "puppy" ≡ "dog", "organization" ≡ "team")
# REPLACE WITH:
from sentence_transformers import SentenceTransformer
_embed_model = SentenceTransformer("all-MiniLM-L6-v2")  # fast, 80MB, works offline

def semantic_similarity(a: str, b: str) -> float:
    """Cosine similarity of sentence embeddings."""
    embs = _embed_model.encode([a, b], normalize_embeddings=True)
    return float(np.dot(embs[0], embs[1]))
```
Singleton-load the model at module level. Cache embeddings with `functools.lru_cache` on the string pair (up to 512 entries). This fixes false positive "MEANING_DRIFT" warnings that destroy user trust in Meaning Lock.

**Named Entity Recognition — Replace regex with spaCy:**
```python
# CURRENT: brittle regex loops for entity detection
# REPLACE WITH:
import spacy
_nlp = spacy.load("en_core_web_sm")  # small model, fast, works offline

def extract_entities(text: str) -> set[str]:
    doc = _nlp(text)
    return {ent.text.lower() for ent in doc.ents}
```
Use this in the meaning evaluation to check entity preservation. This replaces the fragile `r"[A-Z][a-z]+ [A-Z][a-z]+"` pattern.

**Rewrite Rules — Massively expand the replacement dictionaries:**

For each mode, expand from ~10 entries to 50+ high-quality replacements. Here are the target counts and quality criteria:
- `clarity_replacements`: 60 entries — target verbose academic and corporate language
- `fluency_replacements`: 40 entries — awkward constructions, passive voice cues
- `humanize_replacements`: 80 entries — AI-signature phrases (based on known LLM artifacts)
- `simple_replacements`: 50 entries — technical jargon → everyday language
- `professional_replacements`: 45 entries — informal language → business register
- `academic_replacements`: 45 entries — colloquial → scholarly vocabulary
- `shorten_replacements`: 35 entries — wordy phrases → concise equivalents
- `expand_replacements`: 30 entries — short phrases → richer descriptions

For `humanize` specifically, add these known AI artifacts to the list:
```python
"it's worth noting that", "it is worth noting", "importantly,",
"in conclusion,", "to summarize,", "as previously mentioned",
"notably,", "significantly,", "furthermore,", "moreover,",
"in summary,", "in essence,", "at its core,", "building upon",
"this underscores", "this highlights", "this demonstrates",
"needless to say", "it goes without saying", "rest assured",
"i would be happy to", "certainly,", "absolutely,", "of course,",
"as an ai", "as a language model", "i must emphasize",
"allow me to", "let me", "having said that", "that being said",
"with that said", "on that note", "it should be noted",
"one might argue", "it can be argued", "it is clear that",
"it is evident that", "it is apparent that"
```

**Passive Voice Detection & Fixing:**
Add a function that detects common passive constructions and rewrites them:
```python
def fix_passive_voice(sentence: str) -> str:
    """Detect simple passive patterns and suggest active rewrites."""
    # patterns: "was [verb]ed by", "were [verb]ed by", "is being [verb]ed"
    # Return original if no actor can be identified (don't guess)
```

**Sentence Variety Score:**
Add evaluation of sentence length variety. A good rewrite avoids monotonous sentence lengths:
```python
def sentence_variety_score(sentences: list[str]) -> float:
    lengths = [len(s.split()) for s in sentences]
    if len(lengths) < 2:
        return 1.0
    std = statistics.stdev(lengths)
    mean = statistics.mean(lengths)
    cv = std / mean if mean > 0 else 0  # coefficient of variation
    return min(1.0, cv * 2)  # higher variety = better score
```

**Readability Score:**
Add Flesch-Kincaid readability as a metric:
```python
def flesch_reading_ease(text: str) -> float:
    words = text.split()
    sentences_count = max(1, len(sent_tokenize(text)))
    syllables = sum(count_syllables(w) for w in words)
    words_count = max(1, len(words))
    fre = 206.835 - 1.015 * (words_count / sentences_count) - 84.6 * (syllables / words_count)
    return max(0.0, min(100.0, fre))
```

**Performance — Add response caching:**
```python
import hashlib
from functools import lru_cache

@lru_cache(maxsize=256)
def _cached_rewrite(text: str, mode: str, tone: str, strength: int) -> dict:
    """Cache identical rewrite requests."""
    cache_key = hashlib.sha256(f"{text}|{mode}|{tone}|{strength}".encode()).hexdigest()
    # check Redis if available, else compute
```

**Evaluation — Return the full set of new metrics:**
Update `RewriteResult` and evaluation output to include:
- `readabilityScore`: 0.0–1.0 (normalized Flesch score)
- `sentenceVarietyScore`: 0.0–1.0
- `passiveVoiceReduced`: boolean
- `aiSignaturesRemoved`: int (count of AI phrases removed)
- `wordCountDelta`: int (positive = expanded, negative = shortened)

---

### 2. `ai-service/app/providers.py`

**Add prompt caching support for OpenAI-compatible providers:**
Structure system prompts so the static portion comes first (gets cached), and only the dynamic text comes in the user message. Add `cache_control` headers for Anthropic-compatible endpoints.

**Add streaming support:**
```python
async def rewrite_streaming(request: RewriteRequest) -> AsyncIterator[str]:
    """Yield text chunks as they arrive from the provider."""
```

**Add retry with exponential backoff:**
```python
import asyncio

async def _call_with_retry(fn, max_retries=3, base_delay=0.5):
    for attempt in range(max_retries):
        try:
            return await fn()
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (429, 502, 503) and attempt < max_retries - 1:
                await asyncio.sleep(base_delay * (2 ** attempt))
            else:
                raise
```

**Add token counting:**
After each provider response, estimate input/output tokens and return them in the response for cost tracking.

---

### 3. `ai-service/app/models.py`

Extend `RewriteResponse` to include all new evaluation fields:
```python
class ExtendedEvaluation(BaseModel):
    meaningScore: float
    confidenceScore: float
    humanizerScore: float
    naturalnessScore: float
    readabilityScore: float          # NEW
    sentenceVarietyScore: float      # NEW
    passiveVoiceReduced: bool        # NEW
    aiSignaturesRemoved: int         # NEW
    wordCountDelta: int              # NEW
    styleNotes: list[str]
    factsPreserved: bool
    citationsPreserved: bool
    warnings: list[RewriteWarning]
```

Add a `RewriteQualityTier` enum:
```python
class QualityTier(str, Enum):
    EXCELLENT = "excellent"   # meaning >= 0.9, confidence >= 0.85
    GOOD = "good"             # meaning >= 0.75, confidence >= 0.70
    FAIR = "fair"             # meaning >= 0.60, confidence >= 0.55
    POOR = "poor"             # below thresholds — warn user
```

---

### 4. `ai-service/app/main.py`

**Add Server-Sent Events streaming endpoint:**
```python
from fastapi.responses import StreamingResponse

@app.post("/rewrite/stream")
async def rewrite_stream(request: RewriteRequest):
    async def event_generator():
        async for chunk in providers.rewrite_streaming(request):
            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

**Add health check with dependency status:**
```python
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": bool(_embed_model),
        "spacy_loaded": bool(_nlp),
        "provider": os.getenv("AI_PROVIDER", "local")
    }
```

**Add request validation middleware** that rejects text > 15,000 chars with a clear error.

**Add Prometheus metrics:**
```python
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)
```

---

### 5. `ai-service/requirements.txt`

Add these dependencies:
```
sentence-transformers==3.0.1
spacy==3.7.6
nltk==3.9.1
numpy==2.1.0
scikit-learn==1.5.2
statistics  # stdlib
prometheus-fastapi-instrumentator==7.0.0
```

Add post-install model downloads to the Dockerfile:
```dockerfile
RUN python -m spacy download en_core_web_sm
RUN python -c "import nltk; nltk.download('punkt')"
```

---

### TIER 2 — Backend Go API

---

### 6. `backend/internal/api/server.go`

**Fix rate limiter memory leak:**
The current `rateLimiter.buckets` map grows unboundedly. Add a cleanup goroutine:
```go
func (rl *RateLimiter) startCleanup(ctx context.Context) {
    ticker := time.NewTicker(5 * time.Minute)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            rl.mu.Lock()
            cutoff := time.Now().Add(-rl.window)
            for ip, b := range rl.buckets {
                if b.lastSeen.Before(cutoff) {
                    delete(rl.buckets, ip)
                }
            }
            rl.mu.Unlock()
        case <-ctx.Done():
            return
        }
    }
}
```
Start this goroutine in `NewServer()`.

**Add request correlation IDs:**
```go
func requestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-ID")
        if id == "" {
            id = uuid.NewString()
        }
        ctx := context.WithValue(r.Context(), contextKeyRequestID, id)
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

**Add structured logging with slog including request IDs:**
Replace plain `slog.Info("request")` with structured fields:
```go
slog.InfoContext(r.Context(), "request completed",
    "method", r.Method,
    "path", r.URL.Path,
    "status", ww.Status(),
    "duration_ms", durationMs,
    "request_id", getRequestID(r.Context()),
    "ip", r.RemoteAddr,
)
```

**Improve CORS — lock down origins in production:**
```go
cors.AllowedOrigins([]string{
    cfg.FrontendURL,  // read from env
    "http://localhost:3000",
})
```

**Add graceful shutdown:**
```go
srv := &http.Server{Addr: ":" + cfg.Port, Handler: r}
go func() {
    if err := srv.ListenAndServe(); err != http.ErrServerClosed {
        log.Fatal(err)
    }
}()
<-sigChan
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(ctx)
```

**Add Redis-backed response cache:**
```go
// In rewrite handler, before calling AI service:
cacheKey := hashRequest(req)
if cached, err := redisClient.Get(ctx, cacheKey).Result(); err == nil {
    w.Header().Set("X-Cache", "HIT")
    json.NewEncoder(w).Encode(cached)
    return
}
// After AI service call:
redisClient.Set(ctx, cacheKey, result, 1*time.Hour)
```

---

### 7. `backend/internal/repository/postgres.go` (NEW FILE — CREATE IT)

Implement the full PostgreSQL repository against the existing schema in `database/migrations/0001_initial.sql`. This is the most critical missing piece.

Implement these interfaces (match signatures in `memory.go`):
```go
type PostgresRewriteRepository struct {
    db *sql.DB
}

func (r *PostgresRewriteRepository) CreateSession(ctx context.Context, session *domain.RewriteSession) error
func (r *PostgresRewriteRepository) GetSession(ctx context.Context, id string) (*domain.RewriteSession, error)
func (r *PostgresRewriteRepository) ListSessions(ctx context.Context) ([]*domain.RewriteSession, error)
func (r *PostgresRewriteRepository) AcceptSession(ctx context.Context, id string) error
func (r *PostgresRewriteRepository) CreatePreset(ctx context.Context, preset *domain.Preset) error
func (r *PostgresRewriteRepository) ListPresets(ctx context.Context) ([]*domain.Preset, error)
func (r *PostgresRewriteRepository) UpdatePreset(ctx context.Context, id string, preset *domain.Preset) error
func (r *PostgresRewriteRepository) DeletePreset(ctx context.Context, id string) error
```

Use `database/sql` with `lib/pq` driver. Add connection pooling:
```go
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(5)
db.SetConnMaxLifetime(5 * time.Minute)
```

In `cmd/api/main.go`, select repository based on `DATABASE_URL` env:
```go
if cfg.DatabaseURL != "" {
    repo = repository.NewPostgresRepository(db)
} else {
    repo = repository.NewMemoryRepository()
    slog.Warn("using in-memory repository — data will not persist")
}
```

---

### 8. `backend/internal/config/config.go`

Add missing config fields:
```go
type Config struct {
    Port         string
    AIServiceURL string
    LogLevel     string
    DatabaseURL  string   // NEW
    RedisURL     string   // NEW
    FrontendURL  string   // NEW
    JWTSecret    string   // NEW
    Environment  string   // NEW: "development" | "production"
}
```

Validate required fields in production mode:
```go
if cfg.Environment == "production" && cfg.JWTSecret == "change-me" {
    return nil, errors.New("JWT_SECRET must be changed in production")
}
```

---

### 9. `backend/internal/domain/models.go`

Add the new evaluation fields to `RewriteEvaluation`:
```go
type RewriteEvaluation struct {
    MeaningScore         float64  `json:"meaningScore"`
    ConfidenceScore      float64  `json:"confidenceScore"`
    HumanizerScore       float64  `json:"humanizerScore"`
    NaturalnessScore     float64  `json:"naturalnessScore"`
    ReadabilityScore     float64  `json:"readabilityScore"`       // NEW
    SentenceVarietyScore float64  `json:"sentenceVarietyScore"`   // NEW
    PassiveVoiceReduced  bool     `json:"passiveVoiceReduced"`    // NEW
    AISignaturesRemoved  int      `json:"aiSignaturesRemoved"`    // NEW
    WordCountDelta       int      `json:"wordCountDelta"`         // NEW
    QualityTier          string   `json:"qualityTier"`            // NEW: excellent/good/fair/poor
    StyleNotes           []string `json:"styleNotes"`
    FactsPreserved       bool     `json:"factsPreserved"`
    CitationsPreserved   bool     `json:"citationsPreserved"`
    Warnings             []RewriteWarning `json:"warnings"`
}
```

---

### 10. `backend/internal/service/rewrite_service.go`

**Add latency tracking with percentiles:**
Record p50/p95/p99 latencies using a simple ring buffer or `prometheus/client_golang`.

**Add async session save:**
After returning the response to the frontend, save to the repository asynchronously using a goroutine with a bounded channel:
```go
go func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := s.repo.CreateSession(ctx, session); err != nil {
        slog.Error("failed to save session", "error", err)
    }
}()
```

**Add input sanitization:**
Strip dangerous HTML/script content from input text before sending to AI service:
```go
import "html"
text = html.EscapeString(strings.TrimSpace(req.Text))
```

---

### TIER 3 — Frontend

---

### 11. `frontend/components/studio/openrewrite-app.tsx`

This 821-line monolith needs structural and performance improvements.

**Split into separate component files:**
```
frontend/components/studio/
├── openrewrite-app.tsx         # Shell, nav, routing only (~100 lines)
├── RewriteStudio.tsx           # Main editor view
├── EditorPanel.tsx             # Input panel
├── OutputPanel.tsx             # Output + interactive text
├── TrustPanel.tsx              # Scores and warnings
├── DiffPanel.tsx               # Sentence diffs
├── HistoryView.tsx
├── PresetsView.tsx
├── SettingsView.tsx
├── ApiKeysView.tsx
└── AdminUsageView.tsx
```

**Add React.memo and useMemo everywhere:**
```tsx
// DiffPanel — memoize the sentence list
const DiffPanel = React.memo(({ diffs }: { diffs: SentenceDiff[] }) => {
    const renderedDiffs = useMemo(() =>
        diffs.map((d, i) => <DiffRow key={i} diff={d} />)
    , [diffs]);
    return <div>{renderedDiffs}</div>;
});
```

**Add useCallback for all event handlers:**
```tsx
const handleRewrite = useCallback(async () => {
    if (!inputText.trim()) return;
    await rewriteMutation.mutateAsync({ text: inputText, ... });
}, [inputText, rewriteMutation]);
```

**Add React ErrorBoundary:**
```tsx
class ErrorBoundary extends React.Component {
    state = { hasError: false, error: null };
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    render() {
        if (this.state.hasError) return <ErrorFallback error={this.state.error} />;
        return this.props.children;
    }
}
```
Wrap the entire app and each major panel in its own boundary.

**Persist dark mode to localStorage:**
```tsx
const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
        return localStorage.getItem("theme") === "dark";
    }
    return false;
});
const toggleDark = useCallback(() => {
    setIsDark(prev => {
        localStorage.setItem("theme", !prev ? "dark" : "light");
        return !prev;
    });
}, []);
```

**Add character / word count display in real time:**
Show below the input textarea:
```tsx
const wordCount = useMemo(() => inputText.trim().split(/\s+/).filter(Boolean).length, [inputText]);
const charCount = inputText.length;
// Render: "342 words · 1,847 characters"
```

**Expand the word alternatives map from ~15 to 200+ entries:**
The current hardcoded synonym map is too small to be useful. Expand it with high-quality alternatives organized by category:
- Over-used adjectives: amazing, great, important, significant, various
- AI-artifact verbs: leverage, utilize, facilitate, streamline, optimize
- Hedging language: somewhat, rather, quite, fairly, relatively
- Formal alternatives for common words
- Tone-appropriate replacements per mode

**Add keyboard shortcut for accepting rewrite:**
```tsx
useEffect(() => {
    const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') {
            if (currentSession) acceptMutation.mutate(currentSession.sessionId);
        }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
}, [currentSession, acceptMutation]);
```

**Add copy-to-clipboard button with visual feedback:**
```tsx
const [copied, setCopied] = useState(false);
const copyOutput = useCallback(async () => {
    await navigator.clipboard.writeText(editedOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
}, [editedOutput]);
// Button shows "Copied!" for 2 seconds
```

**Show new evaluation metrics in TrustPanel:**
Add visual indicators for:
- Readability score with label ("Grade 8 reading level")
- Sentence variety (monotone → varied)
- AI signatures removed (count badge)
- Word count delta ("+42 words" or "−17 words")
- Quality tier chip (Excellent / Good / Fair / Poor) with color coding

**Add streaming support in the UI:**
When the rewrite endpoint supports streaming, display tokens as they arrive:
```tsx
const [streamingText, setStreamingText] = useState("");
// Use EventSource or fetch with ReadableStream
```

**Improve the diff visualization:**
- Add inline word-level diff highlighting within each sentence (not just sentence-level)
- Use green for additions, red for deletions, grey for unchanged
- Add a "collapse unchanged" toggle to hide sentences that weren't modified

**Accessibility improvements:**
```tsx
// Add aria-labels to all interactive elements
<Slider aria-label="Rewrite strength" aria-valuemin={0} aria-valuemax={100} />
<button aria-label={`Select alternative: ${alt}`} onClick={() => applyAlt(alt)}>
<textarea aria-label="Input text to rewrite" />
```

**Add loading skeleton for diff panel:**
While the rewrite is in progress, show animated skeleton cards instead of blank space.

---

### 12. `frontend/lib/api.ts`

**Add retry logic:**
```typescript
async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.ok || res.status < 500) return res;
            if (i < retries - 1) await sleep(300 * Math.pow(2, i));
        } catch (e) {
            if (i === retries - 1) throw e;
            await sleep(300 * Math.pow(2, i));
        }
    }
    throw new Error("Max retries exceeded");
}
```

**Add request deduplication:**
TanStack Query handles deduplication for reads, but for the mutation add a debounce guard to prevent double-submit:
```typescript
let rewriteInFlight = false;
export async function rewriteText(req: RewriteRequest): Promise<RewriteSession> {
    if (rewriteInFlight) throw new Error("Rewrite already in progress");
    rewriteInFlight = true;
    try {
        return await post("/v1/rewrite", req);
    } finally {
        rewriteInFlight = false;
    }
}
```

**Add response type validation:**
```typescript
import { z } from "zod";
const response = await fetch(...);
const data = await response.json();
return RewriteSessionSchema.parse(data); // throws ZodError if backend sends bad data
```

**Add streaming support:**
```typescript
export async function* rewriteTextStream(req: RewriteRequest): AsyncGenerator<string> {
    const res = await fetch(`${API_BASE}/v1/rewrite/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
                yield JSON.parse(line.slice(6)).chunk;
            }
        }
    }
}
```

---

### 13. `frontend/lib/diff.ts`

**Implement inline word-level diffing:**
The current file only does sentence-level diff status. Add word-level diffing within each sentence pair:
```typescript
export type WordDiff = {
    text: string;
    type: "unchanged" | "added" | "removed";
};

export function wordDiff(original: string, rewritten: string): WordDiff[] {
    // Use Myers diff algorithm on word tokens
    // Return array of word spans with change type
}
```

**Use Myers diff algorithm (O(nd)) instead of simple LCS:**
```typescript
// Implement the Myers diff algorithm for O(nd) performance
// Much faster than the current O(n*m) SequenceMatcher approach
// Reference: https://neil.fraser.name/writing/diff/
function myersDiff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Edit[]
```

**Add caching for repeated diff calculations:**
```typescript
const diffCache = new Map<string, WordDiff[]>();
export function cachedWordDiff(a: string, b: string): WordDiff[] {
    const key = `${a}|||${b}`;
    if (diffCache.has(key)) return diffCache.get(key)!;
    const result = wordDiff(a, b);
    if (diffCache.size > 500) diffCache.clear(); // simple eviction
    diffCache.set(key, result);
    return result;
}
```

---

### 14. `frontend/lib/contracts.ts`

Extend the Zod schemas to include all new evaluation fields:
```typescript
export const RewriteEvaluationSchema = z.object({
    meaningScore: z.number().min(0).max(1),
    confidenceScore: z.number().min(0).max(1),
    humanizerScore: z.number().min(0).max(1),
    naturalnessScore: z.number().min(0).max(1),
    readabilityScore: z.number().min(0).max(1),       // NEW
    sentenceVarietyScore: z.number().min(0).max(1),   // NEW
    passiveVoiceReduced: z.boolean(),                  // NEW
    aiSignaturesRemoved: z.number().int(),             // NEW
    wordCountDelta: z.number().int(),                  // NEW
    qualityTier: z.enum(["excellent", "good", "fair", "poor"]),  // NEW
    styleNotes: z.array(z.string()),
    factsPreserved: z.boolean(),
    citationsPreserved: z.boolean(),
    warnings: z.array(RewriteWarningSchema),
});
```

---

### 15. `frontend/lib/studio-store.ts`

**Add new state for streaming and history filtering:**
```typescript
interface StudioStore {
    // existing...
    isStreaming: boolean;
    streamingChunks: string[];
    historyFilter: "all" | "accepted" | "rejected";
    sortOrder: "newest" | "oldest";
    setHistoryFilter: (f: "all" | "accepted" | "rejected") => void;
    setSortOrder: (o: "newest" | "oldest") => void;
    appendStreamChunk: (chunk: string) => void;
    setStreaming: (v: boolean) => void;
    clearStreamChunks: () => void;
}
```

**Persist mode, tone, strength, and provider selections to localStorage:**
```typescript
persist(
    (set) => ({ ... }),
    {
        name: "openrewrite-studio-settings",
        partialize: (state) => ({
            mode: state.mode,
            tone: state.tone,
            strength: state.strength,
            provider: state.provider,
            meaningLock: state.meaningLock,
        }),
    }
)
```

---

### TIER 4 — Infrastructure & Operations

---

### 16. `nginx/default.conf`

**Add compression:**
```nginx
gzip on;
gzip_types text/plain application/json text/event-stream;
gzip_min_length 1024;
```

**Add security headers:**
```nginx
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header X-XSS-Protection "1; mode=block";
add_header Referrer-Policy "strict-origin-when-cross-origin";
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';";
```

**Add SSE-friendly proxy settings:**
```nginx
location /v1/rewrite/stream {
    proxy_pass http://api:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    chunked_transfer_encoding on;
}
```

**Add rate limiting at nginx level (defense in depth):**
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req zone=api burst=10 nodelay;
```

---

### 17. `docker-compose.yml`

**Add health checks:**
```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
  ai-service:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 15s  # model loading takes longer
      retries: 5
      start_period: 60s  # give spaCy/sentence-transformers time to load
```

**Add resource limits:**
```yaml
services:
  ai-service:
    deploy:
      resources:
        limits:
          memory: 2G  # sentence-transformers + spaCy need ~800MB
        reservations:
          memory: 512M
```

**Add proper depends_on ordering with condition:**
```yaml
api:
  depends_on:
    postgres:
      condition: service_healthy
    ai-service:
      condition: service_healthy
```

---

### 18. `ai-service/Dockerfile`

**Use multi-stage build:**
```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /install /usr/local
COPY app/ ./app/

# Pre-download models at build time (not runtime)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
RUN python -m spacy download en_core_web_sm
RUN python -c "import nltk; nltk.download('punkt_tab')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

---

### TIER 5 — Tests

---

### 19. `ai-service/tests/test_rewrite_engine.py`

**Add tests for all new functionality:**
```python
def test_sentence_splitting_handles_abbreviations():
    text = "Dr. Smith wrote to Prof. Jones. They agreed."
    sentences = split_sentences(text)
    assert len(sentences) == 2  # not 4 (broken on "Dr." and "Prof.")

def test_semantic_similarity_catches_synonyms():
    score = semantic_similarity("The dog ran fast.", "The puppy sprinted quickly.")
    assert score > 0.7  # should be high — same meaning

def test_humanize_removes_ai_artifacts():
    text = "It is worth noting that this approach is robust and leverages best practices."
    result = rewrite(text, mode="humanize", tone="neutral", strength=80)
    assert "it is worth noting" not in result.lower()
    assert "leverages" not in result.lower()
    assert "robust" not in result.lower()

def test_meaning_lock_doesnt_trigger_on_synonyms():
    original = "The team completed the project."
    rewritten = "The organization finished the initiative."
    score = semantic_similarity(original, rewritten)
    # With embeddings, score should be >= 0.75, not trigger MEANING_DRIFT

def test_readability_score_improves_for_simple_mode():
    complex_text = "The utilization of advanced methodologies necessitates comprehensive implementation strategies."
    result = rewrite(complex_text, mode="simple", tone="neutral", strength=80)
    original_score = flesch_reading_ease(complex_text)
    rewritten_score = flesch_reading_ease(result.rewrittenText)
    assert rewritten_score > original_score  # simple mode should improve readability
```

---

### 20. `backend/internal/api/server_test.go`

**Add tests for:**
- Rate limiter cleanup goroutine
- Request ID propagation
- PostgreSQL repository round-trip (create → get → accept)
- Cache HIT header on second identical rewrite
- Proper CORS headers in production mode

---

### 21. `frontend/tests/unit/diff.test.ts`

**Add tests for new word-level diff:**
```typescript
test("wordDiff identifies added words", () => {
    const diff = wordDiff("The cat sat.", "The large cat sat quietly.");
    const added = diff.filter(d => d.type === "added").map(d => d.text);
    expect(added).toContain("large");
    expect(added).toContain("quietly");
});

test("wordDiff handles complete rewrites gracefully", () => {
    const diff = wordDiff("Quick brown fox.", "Lazy purple dog.");
    expect(diff.every(d => d.type !== "unchanged")).toBe(true);
});
```

---

## Quality Criteria

When you're done, this is what "done" looks like:

1. **Rewrite quality** — "humanize" mode eliminates all common AI artifacts. Running a GPTZero-style check on output would show < 20% AI probability. QuillBot's humanizer output typically leaves 40–60% AI probability.

2. **Meaning preservation** — Semantic similarity (cosine of embeddings) between original and rewritten text stays > 0.82 for normal rewrites. The old lexical system was scoring false positives 30% of the time.

3. **Latency** — Local provider completes in < 200ms for text up to 2,000 characters. External provider calls complete in < 4s for same length. Streaming endpoint shows first token within 500ms.

4. **Reliability** — Rate limiter memory is bounded. In-memory store never chosen accidentally in production. Redis cache prevents duplicate AI calls for identical requests.

5. **Trust** — No false "MEANING_DRIFT_DETECTED" warnings for synonym-level changes. Users should see warnings only when actual meaning has shifted.

6. **UX** — Dark mode persists. Rewrite settings persist. Word count shown. Copy button visible. Keyboard shortcuts documented in UI. Error messages are human-readable and actionable.

7. **Tests** — `pytest` suite covers all rewrite modes with quality assertions, not just "it runs". Go tests cover the full HTTP flow including PostgreSQL round-trips.

---

## Constraints

- Do NOT change the AGPL-3.0 license.
- Do NOT add paid-only features gated by a license check.
- Do NOT add any telemetry or tracking that phones home.
- Do NOT remove the ethical framing around AI detector bypass — the product's ethics are a feature.
- Maintain backward API compatibility on all `/v1/` routes. New fields in responses are additive.
- Keep the local deterministic provider working offline with no internet or API keys required.
- The `sentence-transformers` model (`all-MiniLM-L6-v2`) must work fully offline after Dockerfile build — no download at runtime.

---

## Where to Start

Begin with `ai-service/app/rewrite_engine.py` — that is the highest-leverage file and everything else builds on it. Then move to `ai-service/app/providers.py` and `models.py`, then the Go backend, then the frontend. Run `pytest`, `go test ./...`, and `npm test` after each tier to verify no regressions.

Good luck. Make this better than QuillBot.
