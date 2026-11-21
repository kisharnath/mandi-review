/**
 * Rules for telling which of several same-named mandis to keep. Pure functions, so they are
 * shared by the Duplicate mandis page and the "exact name match" auto-approval.
 */
export type DupCandidate = {
  _id: { toString(): string };
  district?: unknown;
  postcode?: unknown;
  location?: unknown;
  /** Listings of the mandi names currently linked to this mandi. */
  listings?: number;
};

const clean = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** How many of district, postcode and location the record has filled in (0–3). */
export function completeness(m: DupCandidate): number {
  return (clean(m.district) ? 1 : 0) + (clean(m.postcode) ? 1 : 0) + (m.location ? 1 : 0);
}

/**
 * Same-named mandis are "safe" copies of one place when no two of them name different districts.
 * A copy without a district fits any district. Two mandis called "Gandhi Chowk" in different
 * districts are probably two real places, so those are left for a person.
 */
export function districtsCompatible(members: DupCandidate[]): boolean {
  return new Set(members.map((m) => clean(m.district)).filter(Boolean)).size <= 1;
}

/** Best one to keep first: most complete record, then the one most names already point at. */
export function rankMandis<T extends DupCandidate>(members: T[]): T[] {
  return [...members].sort(
    (a, b) =>
      completeness(b) - completeness(a) ||
      (b.listings ?? 0) - (a.listings ?? 0) ||
      a._id.toString().localeCompare(b._id.toString()),
  );
}
