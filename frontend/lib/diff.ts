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

// ---------------------------------------------------------------------------
// Word-level diff
// ---------------------------------------------------------------------------

export type WordDiff = {
  text: string;
  type: "unchanged" | "added" | "removed";
};

type EditOp = {
  type: "equal" | "insert" | "delete";
  items: string[];
};

/** Append an op to the list, merging with the last op when types match. */
function appendOp(ops: EditOp[], op: EditOp): void {
  if (ops.length > 0 && ops[ops.length - 1].type === op.type) {
    ops[ops.length - 1].items.push(...op.items);
  } else {
    ops.push({ type: op.type, items: op.items.slice() });
  }
}

/**
 * Myers O(nd) diff algorithm.
 * Returns a list of edit operations between arrays `a` and `b`.
 * - "equal"  — items present in both sequences (no change)
 * - "delete" — items from `a` that are absent in `b`
 * - "insert" — items from `b` that are absent in `a`
 */
function myersDiff(a: string[], b: string[]): EditOp[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: "insert", items: b.slice() }];
  if (m === 0) return [{ type: "delete", items: a.slice() }];

  // Diagonal indices range from -m to n; offset so we can use a plain array.
  const offset = m;
  const size = n + m;
  const v = new Int32Array(size + 2);
  // snapshots[d] = copy of v after exploring all diagonals at edit distance d
  const snapshots: Int32Array[] = [];

  outer: for (let d = 0; d <= size; d++) {
    snapshots.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const ki = k + offset;
      // Choose: move down (insert from b) or right (delete from a)
      let x: number;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1]; // down
      } else {
        x = v[ki - 1] + 1; // right
      }
      let y = x - k;
      // Follow the snake (consecutive equal elements)
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[ki] = x;
      if (x >= n && y >= m) {
        break outer;
      }
    }
  }

  // Backtrack through snapshots to reconstruct the edit path.
  // We collect individual edit atoms in reverse, then reverse at the end.
  const edits: Array<{ type: "equal" | "insert" | "delete"; text: string }> = [];
  let x = n;
  let y = m;

  for (let d = snapshots.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const snap = snapshots[d];
    const k = x - y;
    const ki = k + offset;

    // Determine which diagonal we came from
    let prevK: number;
    if (k === -d || (k !== d && snap[ki - 1] < snap[ki + 1])) {
      prevK = k + 1; // came from a down move (insert)
    } else {
      prevK = k - 1; // came from a right move (delete)
    }

    const prevX = snap[prevK + offset];
    const prevY = prevX - prevK;

    // Unwind the snake (equal elements) from (x,y) back toward the edit point
    while (x > prevX && y > prevY && a[x - 1] === b[y - 1]) {
      edits.push({ type: "equal", text: a[x - 1] });
      x--;
      y--;
    }

    // The single non-diagonal step
    if (d > 0) {
      if (x > prevX) {
        edits.push({ type: "delete", text: a[x - 1] });
        x--;
      } else if (y > prevY) {
        edits.push({ type: "insert", text: b[y - 1] });
        y--;
      }
    }
  }

  edits.reverse();

  // Group consecutive same-type edits into ops
  const ops: EditOp[] = [];
  for (const edit of edits) {
    appendOp(ops, { type: edit.type, items: [edit.text] });
  }

  return ops;
}

/**
 * Split a string into word-level tokens, keeping whitespace runs as separate
 * tokens so the diff result can be re-joined to recover original spacing.
 * Punctuation stays attached to the surrounding word (e.g. "hello," is one token).
 */
function splitWords(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/**
 * Compute a word-level diff between two strings using the Myers algorithm.
 * Each entry in the returned array represents one token (word or whitespace run).
 * Whitespace tokens are included so callers can reconstruct readable output.
 */
export function wordDiff(original: string, rewritten: string): WordDiff[] {
  const aTokens = splitWords(original);
  const bTokens = splitWords(rewritten);
  const ops = myersDiff(aTokens, bTokens);

  const result: WordDiff[] = [];
  for (const op of ops) {
    const type: WordDiff["type"] =
      op.type === "equal" ? "unchanged" : op.type === "delete" ? "removed" : "added";
    for (const text of op.items) {
      result.push({ text, type });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cached word diff
// ---------------------------------------------------------------------------

const CACHE_MAX = 500;
const wordDiffCache = new Map<string, WordDiff[]>();

/**
 * Memoised wrapper around wordDiff.
 * Holds up to 500 entries; when the limit is exceeded the entire cache is
 * cleared (simple overflow strategy — avoids unbounded memory growth while
 * still providing a useful hot-path hit rate for repeated comparisons).
 */
export function cachedWordDiff(a: string, b: string): WordDiff[] {
  // Use a null byte as separator — it cannot appear in normal text tokens
  const key = `${a}\x00${b}`;
  const cached = wordDiffCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = wordDiff(a, b);

  if (wordDiffCache.size >= CACHE_MAX) {
    wordDiffCache.clear();
  }
  wordDiffCache.set(key, result);

  return result;
}
