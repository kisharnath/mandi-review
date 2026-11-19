import type { Db, ObjectId } from "mongodb";
import { COLL, MAX_TIME_MS } from "./db";
import { mandiKey } from "./heuristics";
import { decideMandiName, stateSpellings, type MandiNameDoc } from "./catalog";
import { writeAudit } from "./audit";
import type { SessionUser } from "./session";

export type Confident = { row: MandiNameDoc; mandiId: ObjectId; mandiName: string; district: string | null };

/**
 * Pending mandi names that match exactly one mandi in the same state after cleaning,
 * and where the old system's guess (if any) agrees. Anything ambiguous is left for a person.
 */
export async function confidentMandiGuesses(db: Db, opts: { state?: string; limit?: number } = {}): Promise<{ items: Confident[]; total: number }> {
  const rows = await db
    .collection<MandiNameDoc>(COLL.mandiNames)
    .find({ status: "pending", ...(opts.state ? { state_code: opts.state } : {}) })
    .sort({ listings: -1 })
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const codes = [...new Set(rows.map((r) => r.state_code).filter(Boolean) as string[])];
  const items: Confident[] = [];
  for (const code of codes) {
    const spellings = await stateSpellings(db, code);
    if (!spellings.length) continue;
    const mandis = await db
      .collection(COLL.mandis)
      .find({ state: { $in: spellings } }, { projection: { name: 1, district: 1 } })
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    const byKey = new Map<string, typeof mandis>();
    for (const m of mandis) {
      const k = mandiKey(String(m.name));
      if (k.length >= 3) byKey.set(k, [...(byKey.get(k) ?? []), m]);
    }
    for (const row of rows.filter((r) => r.state_code === code)) {
      const k = mandiKey(row.raw_name);
      const hits = byKey.get(k);
      if (k.length < 3 || !hits || hits.length !== 1) continue;
      const sug = row.suggestion?.mandi_id;
      if (sug && String(sug) !== String(hits[0]._id)) continue;
      items.push({ row, mandiId: hits[0]._id, mandiName: String(hits[0].name), district: hits[0].district ? String(hits[0].district) : null });
    }
  }
  items.sort((a, b) => (b.row.listings ?? 0) - (a.row.listings ?? 0));
  return { total: items.length, items: opts.limit ? items.slice(0, opts.limit) : items };
}

/** Approve every confident guess. They stay in "Double-check" because nobody looked at each one. */
export async function approveConfidentMandiGuesses(db: Db, user: SessionUser, state?: string): Promise<{ approved: number; listings: number }> {
  const { items } = await confidentMandiGuesses(db, { state });
  let listings = 0;
  for (const it of items) {
    const res = await decideMandiName(db, user, it.row._id, { status: "approved", mandiId: it.mandiId, notes: "Bulk approved: exact name match" });
    listings += res.listings;
    await db.collection(COLL.mandiNames).updateOne({ _id: it.row._id }, { $set: { needs_check: true } });
  }
  await writeAudit(db, user, { action: "mandi_name.bulk_approve", summary: `Bulk approved ${items.length} mandi names by exact name match${state ? ` (${state})` : ""}`, target: { state: state ?? null, count: items.length } });
  return { approved: items.length, listings };
}
