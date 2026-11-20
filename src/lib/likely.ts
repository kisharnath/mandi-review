import { mandiKey } from "./heuristics";
import { normName } from "./format";

/** Edit distance, capped: returns > max as soon as it must exceed it. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function fuzzy(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return 70;
  if (short.length >= 5 && long.includes(short)) return 55;
  const max = short.length >= 8 ? 2 : short.length >= 4 ? 1 : 0;
  if (max && distance(a, b, max) <= max) return 60 - 10 * distance(a, b, max);
  return 0;
}

export type MandiCandidate = { _id: unknown; name: string; district?: string | null; aliases?: string[] | null };

/**
 * Rank mandis for a source's mandi name. Noise words ("APMC", "mandi") are dropped first,
 * so "ABC APMC" looks only for "abc", and both "ABC" and "ABC APMC" in the database match.
 * Equal keys score the same: the person picks between them (district helps).
 */
export function likelyMandis<T extends MandiCandidate>(raw: string, mandis: T[], district?: string | null, limit = 6): (T & { score: number })[] {
  const key = mandiKey(raw);
  if (key.length < 2) return [];
  const rawWords = normName(raw).replace(/\([^)]*\)/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: (T & { score: number })[] = [];
  for (const m of mandis) {
    const keys = [m.name, ...(m.aliases ?? [])].map((n) => mandiKey(String(n))).filter(Boolean);
    let score = Math.max(0, ...keys.map((k) => fuzzy(key, k)));
    // Any word in common (multi-word names like "new grain market")
    if (!score) {
      const words = new Set(rawWords);
      const hit = [m.name, ...(m.aliases ?? [])].some((n) => normName(String(n)).split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 5 && words.has(w)));
      if (hit) score = 30;
    }
    if (!score) continue;
    if (district && m.district && normName(district) === normName(m.district)) score += 15;
    out.push({ ...m, score });
  }
  return out.sort((a, b) => b.score - a.score || String(a.name).length - String(b.name).length).slice(0, limit);
}

// Only words that never separate one crop from another. "green" and "dry" do, so they stay.
const CROP_FILLER = new Set(["common", "local", "other", "others", "general", "ordinary", "normal", "regular", "grade", "for", "and", "the", "with", "per", "kg"]);
const crude = (w: string) => w.replace(/(es|s)$/, "");

/** Crop name without brackets, filler words and plural endings, so "Green Chillies (Dry)" ~ "green chilli". */
export function cropKey(name: string): string {
  return normName(name)
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !CROP_FILLER.has(w))
    .map(crude)
    .sort()
    .join(" ");
}

export type ProductCandidate = { _id: unknown; name: string; cropName?: string | null };

/** Rank products for a source's crop name by whole-name and word-by-word similarity. */
export function likelyProducts<T extends ProductCandidate>(raw: string, products: T[], limit = 6): (T & { score: number })[] {
  const key = cropKey(raw);
  const words = key.split(" ").filter(Boolean);
  if (!words.length) return [];
  const out: (T & { score: number })[] = [];
  for (const p of products) {
    const names = [p.name, p.cropName ?? ""].filter(Boolean);
    let score = 0;
    for (const n of names) {
      const k = cropKey(n);
      score = Math.max(score, fuzzy(key, k));
      const pw = k.split(" ").filter(Boolean);
      if (pw.length && words.length) {
        const matched = pw.filter((w) => words.some((x) => fuzzy(x, w) >= 55)).length;
        // every word of the product name appears in the raw name (or vice versa)
        if (matched === pw.length) score = Math.max(score, 50 + (pw.length === words.length ? 15 : 0));
        else if (matched) score = Math.max(score, 25 + 10 * (matched / pw.length));
      }
    }
    if (n0(score)) out.push({ ...p, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit);
}
const n0 = (s: number) => s > 0;
