import { describe, expect, it } from "vitest";
import { buildSentenceDiffs, calculateChangeRatio, classifyDiff, splitSentences } from "@/lib/diff";

describe("diff utilities", () => {
  it("splits text into trimmed sentences", () => {
    expect(splitSentences("First sentence. Second sentence!  Third?")).toEqual(["First sentence.", "Second sentence!", "Third?"]);
  });

  it("calculates no change for identical text", () => {
    expect(calculateChangeRatio("Keep this sentence.", "Keep this sentence.")).toBe(0);
  });

  it("classifies high-risk changes when meaning score is low", () => {
    expect(classifyDiff(0.7, 0.4)).toBe("high-risk");
  });

  it("builds sentence diffs for uneven sentence counts", () => {
    const diffs = buildSentenceDiffs("One. Two.", "One rewritten.");
    expect(diffs).toHaveLength(2);
    expect(diffs[1]?.rewritten).toBe("");
  });
});
