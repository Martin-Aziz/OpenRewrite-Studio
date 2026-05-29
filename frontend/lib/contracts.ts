import { z } from "zod";

export const rewriteModes = [
  "standard",
  "fluency",
  "professional",
  "simple",
  "shorten",
  "expand",
  "natural",
  "humanize",
  "academic"
] as const;

export const rewriteTones = ["neutral", "warm", "direct", "formal", "confident", "friendly"] as const;

export const rewriteProviders = ["local", "openai-compatible", "ollama"] as const;

export const rewriteRequestSchema = z.object({
  text: z.string().trim().min(1, "Paste text before rewriting.").max(12_000),
  mode: z.enum(rewriteModes),
  tone: z.enum(rewriteTones),
  strength: z.number().int().min(0).max(100),
  meaningLock: z.boolean(),
  provider: z.enum(rewriteProviders)
});

export const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(rewriteModes),
  tone: z.enum(rewriteTones),
  strength: z.number().int().min(0).max(100),
  meaningLock: z.boolean()
});

export type RewriteMode = (typeof rewriteModes)[number];
export type RewriteTone = (typeof rewriteTones)[number];
export type RewriteProvider = (typeof rewriteProviders)[number];
export type RewriteRequest = z.infer<typeof rewriteRequestSchema>;
export type RewritePreset = z.infer<typeof presetSchema>;

export interface SentenceDiff {
  index: number;
  original: string;
  rewritten: string;
  changeRatio: number;
  status: "unchanged" | "light" | "changed" | "high-risk";
}

export interface RewriteWarning {
  code: string;
  message: string;
  sentenceIndex?: number;
  confidence: number;
}

export interface RewriteEvaluation {
  meaningScore: number;
  confidenceScore: number;
  humanizerScore: number;
  naturalnessScore: number;
  styleNotes: string[];
  factsPreserved: boolean;
  citationsPreserved: boolean;
  warnings: RewriteWarning[];
}

export interface RewriteResponse {
  sessionId: string;
  originalText: string;
  rewrittenText: string;
  mode: RewriteMode;
  tone: RewriteTone;
  strength: number;
  provider: string;
  diffs: SentenceDiff[];
  evaluation: RewriteEvaluation;
  createdAt: string;
}

export interface ApiKeyResponse {
  id: string;
  name: string;
  tokenPreview: string;
  createdAt: string;
}

export interface UsageSummary {
  rewriteCount: number;
  acceptedCount: number;
  averageMeaningScore: number;
  averageLatencyMs: number;
}
