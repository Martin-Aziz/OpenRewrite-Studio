import { describe, expect, it } from "vitest";
import {
  buildSentenceDiffs,
  cachedWordDiff,
  calculateChangeRatio,
  classifyDiff,
  splitSentences,
  wordDiff,
} from "@/lib/diff";

// ---------------------------------------------------------------------------
// splitSentences
// ---------------------------------------------------------------------------

describe("splitSentences", () => {
  it("splits text into trimmed sentences", () => {
    expect(splitSentences("First sentence. Second sentence!  Third?")).toEqual([
      "First sentence.",
      "Second sentence!",
      "Third?",
    ]);
  });

  it("returns a single sentence when there is no boundary", () => {
    expect(splitSentences("No boundary here")).toEqual(["No boundary here"]);
  });

  it("filters out empty tokens", () => {
    const result = splitSentences("  Hello world.  ");
    expect(result).toEqual(["Hello world."]);
  });
});

// ---------------------------------------------------------------------------
// calculateChangeRatio
// ---------------------------------------------------------------------------

describe("calculateChangeRatio", () => {
  it("returns 0 for identical text", () => {
    expect(calculateChangeRatio("Keep this sentence.", "Keep this sentence.")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially changed text", () => {
    const ratio = calculateChangeRatio("The quick brown fox.", "The fast brown fox.");
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("returns 1 for completely different text", () => {
    const ratio = calculateChangeRatio("alpha beta gamma", "delta epsilon zeta");
    expect(ratio).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// classifyDiff
// ---------------------------------------------------------------------------

describe("classifyDiff", () => {
  it("classifies as unchanged when changeRatio is 0", () => {
    expect(classifyDiff(0, 0.9)).toBe("unchanged");
  });

  it("classifies as light for small change ratios", () => {
    expect(classifyDiff(0.2, 0.8)).toBe("light");
  });

  it("classifies as changed for moderate change ratios with normal meaning score", () => {
    expect(classifyDiff(0.5, 0.8)).toBe("changed");
  });

  it("classifies as high-risk when meaning score is low and change ratio is high", () => {
    expect(classifyDiff(0.7, 0.4)).toBe("high-risk");
  });

  it("does not classify as high-risk when meaning score is acceptable", () => {
    const status = classifyDiff(0.7, 0.7);
    expect(status).not.toBe("high-risk");
  });
});

// ---------------------------------------------------------------------------
// buildSentenceDiffs
// ---------------------------------------------------------------------------

describe("buildSentenceDiffs", () => {
  it("builds sentence diffs for uneven sentence counts", () => {
    const diffs = buildSentenceDiffs("One. Two.", "One rewritten.");
    expect(diffs).toHaveLength(2);
    expect(diffs[1]?.rewritten).toBe("");
  });

  it("returns correct index for each diff entry", () => {
    const diffs = buildSentenceDiffs("First. Second.", "First. Second.");
    expect(diffs[0]?.index).toBe(0);
    expect(diffs[1]?.index).toBe(1);
  });

  it("marks identical sentences as unchanged", () => {
    const diffs = buildSentenceDiffs("Same sentence.", "Same sentence.", 1);
    expect(diffs[0]?.status).toBe("unchanged");
  });

  it("includes original and rewritten fields on each entry", () => {
    const diffs = buildSentenceDiffs("Old text.", "New text.");
    expect(diffs[0]).toHaveProperty("original");
    expect(diffs[0]).toHaveProperty("rewritten");
    expect(diffs[0]).toHaveProperty("changeRatio");
    expect(diffs[0]).toHaveProperty("status");
  });
});

// ---------------------------------------------------------------------------
// wordDiff
// ---------------------------------------------------------------------------

describe("wordDiff", () => {
  it("identifies added words", () => {
    const diff = wordDiff("The cat sat.", "The large cat sat quietly.");
    const added = diff.filter((d) => d.type === "added").map((d) => d.text);
    expect(added).toContain("large");
    expect(added).toContain("quietly.");
  });

  it("identifies removed words", () => {
    const diff = wordDiff("The quick brown fox.", "The fox.");
    const removed = diff.filter((d) => d.type === "removed").map((d) => d.text);
    expect(removed).toContain("quick");
    expect(removed).toContain("brown");
  });

  it("marks unchanged words", () => {
    const diff = wordDiff("Hello world", "Hello world");
    expect(diff.every((d) => d.type === "unchanged")).toBe(true);
  });

  it("handles complete rewrites", () => {
    const diff = wordDiff("Quick brown fox.", "Lazy purple dog.");
    const changed = diff.filter((d) => d.type !== "unchanged");
    expect(changed.length).toBeGreaterThan(0);
  });

  it("handles empty strings", () => {
    const diff = wordDiff("", "");
    expect(diff).toEqual([]);
  });

  it("handles one empty string", () => {
    const diff = wordDiff("", "Hello world");
    // splitWords keeps whitespace as a separate token, so "Hello world" → ["Hello", " ", "world"]
    const added = diff.filter((d) => d.type === "added");
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(added.map((d) => d.text)).toContain("Hello");
    expect(added.map((d) => d.text)).toContain("world");
  });

  it("returns array of WordDiff objects with required shape", () => {
    const diff = wordDiff("Hello world.", "Hello beautiful world.");
    for (const d of diff) {
      expect(d).toHaveProperty("text");
      expect(d).toHaveProperty("type");
      expect(["unchanged", "added", "removed"]).toContain(d.type);
    }
  });
});

// ---------------------------------------------------------------------------
// cachedWordDiff
// ---------------------------------------------------------------------------

describe("cachedWordDiff", () => {
  it("returns same result as wordDiff", () => {
    const a = "The dog barked.";
    const b = "The cat meowed.";
    expect(cachedWordDiff(a, b)).toEqual(wordDiff(a, b));
  });

  it("returns cached result on second call", () => {
    const a = "Cached input text.";
    const b = "Cached output text.";
    const first = cachedWordDiff(a, b);
    const second = cachedWordDiff(a, b);
    expect(first).toEqual(second);
  });
});
