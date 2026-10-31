/**
 * Flags for crop names that are probably in the wrong crop group.
 * These are hints for a reviewer, never automatic changes.
 */

// Words that say nothing about which crop it is.
const FILLER = new Set([
  "common", "local", "other", "others", "general", "ordinary", "normal", "regular", "whole", "split",
  "raw", "dry", "dried", "fresh", "green", "red", "white", "black", "yellow", "big", "small", "medium",
  "fine", "superfine", "grade", "loose", "for", "each", "and", "the", "seed", "seeds", "leaf", "leaves",
  "veg", "vegetable", "vegetables", "fruit", "fruits", "dal", "dhal", "with", "per", "kg", "bunch",
]);

export function wordsOf(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !FILLER.has(w));
}

const LATIN = /^[a-z0-9]+$/;

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

function related(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(4, a.length, b.length);
  if (a.slice(0, n) === b.slice(0, n) || a.includes(b) || b.includes(a)) return true;
  // Spelling variants: "soyabean"/"soybean", "raddish"/"radish", "cummin"/"cumin".
  return Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 5));
}

export type NameFlag = "unmatched" | "looks_wrong" | "other_script" | "in_many_groups";

/**
 * Does `name` share any meaningful word with its group's canonical name or
 * with the group's other well-known aliases? If not, a reviewer should look.
 */
export function looksWrong(name: string, canonical: string | null | undefined, groupAliases: string[] = []): boolean {
  const nameWords = wordsOf(name).filter((w) => LATIN.test(w));
  if (nameWords.length === 0) return false; // non-Latin script: can't judge by spelling
  const reference = [canonical ?? "", ...groupAliases.slice(0, 50)].flatMap(wordsOf).filter((w) => LATIN.test(w));
  if (reference.length === 0) return false;
  const canonWords = wordsOf(canonical).filter((w) => LATIN.test(w));
  // Must relate to the canonical name itself; aliases only count when they also relate to it.
  const trusted = reference.filter((r) => canonWords.some((c) => related(r, c)));
  return !nameWords.some((w) => trusted.some((r) => related(w, r)));
}

export function isOtherScript(name: string): boolean {
  return /[^\u0000-ɏ\s\p{P}\p{N}]/u.test(name);
}
