import type { SentenceDiff } from "@/lib/contracts";

const sentenceBoundary = /(?<=[.!?])\s+/u;

export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(sentenceBoundary)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function calculateChangeRatio(original: string, rewritten: string): number {
  if (original === rewritten) {
    return 0;
  }

  const originalWords = tokenize(original);
  const rewrittenWords = tokenize(rewritten);
  const sharedWords = originalWords.filter((word) => rewrittenWords.includes(word)).length;
  const longestLength = Math.max(originalWords.length, rewrittenWords.length, 1);

  return Number((1 - sharedWords / longestLength).toFixed(2));
}

export function classifyDiff(changeRatio: number, meaningScore: number): SentenceDiff["status"] {
  if (meaningScore < 0.65 && changeRatio > 0.35) {
    return "high-risk";
  }

  if (changeRatio === 0) {
    return "unchanged";
  }

  if (changeRatio < 0.35) {
    return "light";
  }

  return "changed";
}

export function buildSentenceDiffs(original: string, rewritten: string, meaningScore = 1): SentenceDiff[] {
  const originals = splitSentences(original);
  const rewrites = splitSentences(rewritten);
  const length = Math.max(originals.length, rewrites.length);

  return Array.from({ length }, (_, index) => {
    const originalSentence = originals[index] ?? "";
    const rewrittenSentence = rewrites[index] ?? "";
    const changeRatio = calculateChangeRatio(originalSentence, rewrittenSentence);

    return {
      index,
      original: originalSentence,
      rewritten: rewrittenSentence,
      changeRatio,
      status: classifyDiff(changeRatio, meaningScore)
    };
  });
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9']+/gu) ?? [];
}
