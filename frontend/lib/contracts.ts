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
  readabilityScore?: number;
  sentenceVarietyScore?: number;
  passiveVoiceReduced?: boolean;
  aiSignaturesRemoved?: number;
  wordCountDelta?: number;
  qualityTier?: "excellent" | "good" | "fair" | "poor";
}

export const rewriteEvaluationSchema = z.object({
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
      sentenceIndex: z.number().int().optional(),
      confidence: z.number()
    })
  ),
  readabilityScore: z.number().min(0).max(1).optional().default(0),
  sentenceVarietyScore: z.number().min(0).max(1).optional().default(0),
  passiveVoiceReduced: z.boolean().optional().default(false),
  aiSignaturesRemoved: z.number().int().optional().default(0),
  wordCountDelta: z.number().int().optional().default(0),
  qualityTier: z.enum(["excellent", "good", "fair", "poor"]).optional().default("good")
});

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
