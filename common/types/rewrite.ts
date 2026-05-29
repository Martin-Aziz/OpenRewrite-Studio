export const REWRITE_MODES = [
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

export const REWRITE_TONES = [
  "neutral",
  "warm",
  "direct",
  "formal",
  "confident",
  "friendly"
] as const;

export type RewriteMode = (typeof REWRITE_MODES)[number];
export type RewriteTone = (typeof REWRITE_TONES)[number];

export interface RewriteRequest {
  text: string;
  mode: RewriteMode;
  tone: RewriteTone;
  strength: number;
  meaningLock: boolean;
  provider: "local" | "openai-compatible" | "ollama";
}

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
