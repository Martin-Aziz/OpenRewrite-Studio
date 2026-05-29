import { z } from "zod";
import {
  type ApiKeyResponse,
  type RewritePreset,
  type RewriteRequest,
  type RewriteResponse,
  type UsageSummary,
  rewriteRequestSchema
} from "@/lib/contracts";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiClientError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const RewriteSessionSchema = z.object({
  sessionId: z.string(),
  originalText: z.string(),
  rewrittenText: z.string(),
  mode: z.string(),
  tone: z.string(),
  strength: z.number(),
  provider: z.string(),
  diffs: z.array(
    z.object({
      index: z.number(),
      original: z.string(),
      rewritten: z.string(),
      changeRatio: z.number(),
      status: z.enum(["unchanged", "light", "changed", "high-risk"])
    })
  ),
  evaluation: z.object({
    meaningScore: z.number(),
    confidenceScore: z.number(),
    humanizerScore: z.number(),
    naturalnessScore: z.number(),
    styleNotes: z.array(z.string()),
    factsPreserved: z.boolean(),
    citationsPreserved: z.boolean(),
    warnings: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        sentenceIndex: z.number().optional(),
        confidence: z.number()
      })
    )
  }),
  createdAt: z.string()
});

// ---------------------------------------------------------------------------
// fetchWithRetry
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 300;

async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    }

    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (networkError) {
      // Network-level failure — retry
      lastError = networkError;
      continue;
    }

    // 4xx — do not retry, return immediately for caller to handle
    if (response.status >= 400 && response.status < 500) {
      return response;
    }

    // 5xx — retry
    if (response.status >= 500) {
      lastError = new ApiClientError(
        `Server error ${response.status}`,
        response.status
      );
      continue;
    }

    // 2xx / 3xx — success
    return response;
  }

  // Exhausted retries
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Request failed after retries");
}

// ---------------------------------------------------------------------------
// In-flight guard for rewriteText
// ---------------------------------------------------------------------------

let rewriteInFlight = false;

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export async function rewriteText(payload: RewriteRequest): Promise<RewriteResponse> {
  if (rewriteInFlight) {
    throw new Error("Rewrite already in progress");
  }

  rewriteInFlight = true;
  try {
    const validatedPayload = rewriteRequestSchema.parse(payload);
    const raw = await postJson<unknown>("/v1/rewrite", validatedPayload);
    return RewriteSessionSchema.parse(raw) as RewriteResponse;
  } finally {
    rewriteInFlight = false;
  }
}

export async function* rewriteTextStream(req: RewriteRequest): AsyncGenerator<string> {
  const validatedPayload = rewriteRequestSchema.parse(req);

  const response = await fetchWithRetry(`${apiBaseUrl}/v1/rewrite/stream`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(validatedPayload)
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    const message = body.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiClientError(message, response.status);
  }

  if (!response.body) {
    throw new ApiClientError("Response body is empty", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice("data:".length).trim();

        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data) as { chunk?: string };
          if (typeof parsed.chunk === "string") {
            yield parsed.chunk;
          }
        } catch {
          // Ignore malformed SSE data lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function listSessions(): Promise<RewriteResponse[]> {
  return getJson<RewriteResponse[]>("/v1/rewrite-sessions");
}

export async function acceptSession(sessionId: string): Promise<RewriteResponse> {
  return postJson<RewriteResponse>(`/v1/rewrite-sessions/${sessionId}/accept`, {});
}

export async function listPresets(): Promise<RewritePreset[]> {
  return getJson<RewritePreset[]>("/v1/presets");
}

export async function createPreset(payload: Omit<RewritePreset, "id">): Promise<RewritePreset> {
  return postJson<RewritePreset>("/v1/presets", payload);
}

export async function createApiKey(name: string): Promise<ApiKeyResponse> {
  return postJson<ApiKeyResponse>("/v1/api-keys", { name });
}

export async function getUsageSummary(): Promise<UsageSummary> {
  return getJson<UsageSummary>("/v1/admin/usage");
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

async function getJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetchWithRetry(`${apiBaseUrl}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  } as RequestInit);

  return parseResponse<TResponse>(response);
}

async function postJson<TResponse>(path: string, payload: unknown): Promise<TResponse> {
  const response = await fetchWithRetry(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return parseResponse<TResponse>(response);
}

async function parseResponse<TResponse>(response: Response): Promise<TResponse> {
  if (response.ok) {
    return (await response.json()) as TResponse;
  }

  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  const message = body.error?.message ?? `Request failed with status ${response.status}`;
  throw new ApiClientError(message, response.status);
}
