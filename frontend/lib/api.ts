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

export async function rewriteText(payload: RewriteRequest): Promise<RewriteResponse> {
  const validatedPayload = rewriteRequestSchema.parse(payload);
  return postJson<RewriteResponse>("/v1/rewrite", validatedPayload);
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

async function getJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  return parseResponse<TResponse>(response);
}

async function postJson<TResponse>(path: string, payload: unknown): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
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
