import "server-only";
import { ObjectId, type Db, type Filter } from "mongodb";
import { writeAudit } from "./audit";
import { COLL, MAX_TIME_MS } from "./db";
import { escapeRegex, normName } from "./format";
import type { SessionUser } from "./session";

/**
 * v2 data model. The scraper copies product_id / mandi_id onto listings only
 * from APPROVED rows here, on every run. The website edits these rows and then
 * refreshes the listings straight away, so a decision shows at once and stays.
 *
 *   crop_names   { source, raw_name, raw_variety ("*" = any), product_id, status, suggestion, decided_by, ... }
 *   mandi_names  { source, state_code, raw_name, mandi_id, status, suggestion, decided_by, ... }
 *   crops        { name, default_product_id, crop_master_id, active }
 *   products     { crop_id, name, form, price_unit, active }
 *   states       { _id: code, name, spellings[] }
 *
 * available_mandi keeps its schema; it is never given new fields here.
 */

export type Status = "pending" | "approved" | "rejected";
export const ANY_VARIETY = "*";

export type CropNameDoc = {
  _id: ObjectId;
  source: string;
  raw_name: string;
  raw_variety: string;
  product_id: ObjectId | null;
  status: Status;
  suggestion?: { product_id?: ObjectId | null; product_name?: string | null; reason?: string | null } | null;
  decided_by?: string | null;
  decided_at?: Date | null;
  needs_check?: boolean;
  notes?: string | null;
  listings?: number;
  first_seen?: Date;
  last_seen?: Date;
};

export type MandiNameDoc = {
  _id: ObjectId;
  source: string;
  state_code: string | null;
  raw_name: string;
  mandi_id: ObjectId | null;
  status: Status;
  suggestion?: { mandi_id?: ObjectId | null; mandi_name?: string | null; reason?: string | null } | null;
  decided_by?: string | null;
  decided_at?: Date | null;
  needs_check?: boolean;
  notes?: string | null;
  listings?: number;
  first_seen?: Date;
  last_seen?: Date;
};

export type CropDoc = { _id: ObjectId; name: string; default_product_id: ObjectId | null; crop_master_id?: unknown; active?: boolean; notes?: string | null };
export type ProductDoc = { _id: ObjectId; crop_id: ObjectId; name: string; form?: string; price_unit?: string; active?: boolean };
export type StateDoc = { _id: string; name: string; spellings: string[] };

/** Exact, case-insensitive, whitespace-tolerant match for a stored raw name. */
function sameText(text: string) {
  const parts = normName(text).split(" ").map(escapeRegex);
  return { $regex: `^\\s*${parts.join("\\s+")}\\s*$`, $options: "i" };
}

// ── Crop name links ─────────────────────────────────────────────────────────

/** Listings a crop-name row governs. A "*" row skips varieties that have their own row. */
async function listingFilterForCropName(db: Db, row: CropNameDoc): Promise<Filter<Record<string, unknown>>> {
  const base: Record<string, unknown> = { source_system: sameText(row.source), commodity_name: sameText(row.raw_name) };
  if (row.raw_variety && row.raw_variety !== ANY_VARIETY) return { ...base, variety: sameText(row.raw_variety) };
  const own = await db
    .collection<CropNameDoc>(COLL.cropNames)
    .distinct("raw_variety", { source: row.source, raw_name: row.raw_name, raw_variety: { $ne: ANY_VARIETY } });
  return own.length ? { ...base, variety: { $nin: own } } : base;
}

export async function decideCropName(
  db: Db,
  user: SessionUser,
  id: ObjectId,
  decision: { status: Status; productId?: ObjectId | null; notes?: string },
) {
  const coll = db.collection<CropNameDoc>(COLL.cropNames);
  const row = await coll.findOne({ _id: id });
  if (!row) throw new Error("That crop name no longer exists.");
  let productName: string | null = null;
  if (decision.status === "approved") {
    if (!decision.productId) throw new Error("Choose a product to approve the link.");
    const product = await db.collection<ProductDoc>(COLL.products).findOne({ _id: decision.productId });
    if (!product) throw new Error("That product no longer exists.");
    productName = product.name;
  }
  const productId = decision.status === "approved" ? decision.productId! : null;
  const now = new Date();
  await coll.updateOne(
    { _id: id },
    { $set: { status: decision.status, product_id: productId, decided_by: user.name, decided_at: now, needs_check: false, notes: decision.notes?.trim() || row.notes || null } },
  );
  const filter = await listingFilterForCropName(db, row);
  const res = await db.collection(COLL.listings).updateMany(filter, { $set: { product_id: productId } });
  await coll.updateOne({ _id: id }, { $set: { listings: await db.collection(COLL.listings).countDocuments(filter) } });

  await writeAudit(db, user, {
    action: `crop_name.${decision.status}`,
    summary:
      decision.status === "approved"
        ? `Approved "${row.raw_name}" (${row.source}) as ${productName}`
        : `${decision.status === "rejected" ? "Rejected" : "Reopened"} "${row.raw_name}" (${row.source})`,
    target: { crop_name_id: id, source: row.source, raw_name: row.raw_name, raw_variety: row.raw_variety },
    before: { status: row.status, product_id: row.product_id },
    after: { status: decision.status, product_id: productId },
    counts: { listings: res.modifiedCount },
  });
  return { listings: res.modifiedCount, productName };
}

/** Add a variety-specific link (e.g. agmarknet "paddy" with variety "basmati" → basmati paddy). */
export async function addVarietyLink(db: Db, user: SessionUser, parentId: ObjectId, variety: string) {
  const coll = db.collection<CropNameDoc>(COLL.cropNames);
  const parent = await coll.findOne({ _id: parentId });
  if (!parent) throw new Error("That crop name no longer exists.");
  const v = normName(variety);
  if (!v || v === ANY_VARIETY) throw new Error("Give the variety exactly as the source writes it.");
  const now = new Date();
  const res = await coll.updateOne(
    { source: parent.source, raw_name: parent.raw_name, raw_variety: v },
    { $setOnInsert: { product_id: null, status: "pending", suggestion: null, decided_by: null, decided_at: null, notes: null, first_seen: now, last_seen: now, listings: 0 } },
    { upsert: true },
  );
  await writeAudit(db, user, { action: "crop_name.add_variety", summary: `Added variety "${v}" for "${parent.raw_name}" (${parent.source})`, target: { parent_id: parentId, variety: v } });
  return res.upsertedId ?? (await coll.findOne({ source: parent.source, raw_name: parent.raw_name, raw_variety: v }))!._id;
}

// ── Crops and products ──────────────────────────────────────────────────────

export async function createCrop(db: Db, user: SessionUser, name: string, notes?: string) {
  const n = normName(name);
  if (!n) throw new Error("Give the crop a name.");
  if (await db.collection(COLL.crops).findOne({ name: n })) throw new Error(`A crop called "${n}" already exists.`);
  const now = new Date();
  const crop = { name: n, category: null, crop_master_id: null, default_product_id: null as ObjectId | null, active: true, notes: notes?.trim() || null, created_at: now, updated_at: now };
  const cropId = (await db.collection(COLL.crops).insertOne(crop)).insertedId;
  const productId = (await db.collection(COLL.products).insertOne({ crop_id: cropId, name: n, form: "raw", price_unit: "Rs/quintal", active: true, created_at: now, updated_at: now })).insertedId;
  await db.collection(COLL.crops).updateOne({ _id: cropId }, { $set: { default_product_id: productId } });
  await writeAudit(db, user, { action: "crop.create", summary: `Created crop ${n} (default product ${n})`, target: { crop_id: cropId, product_id: productId } });
  return { cropId, productId };
}

export async function createProduct(db: Db, user: SessionUser, cropId: ObjectId, name: string, form = "raw") {
  const n = normName(name);
  if (!n) throw new Error("Give the product a name.");
  const crop = await db.collection<CropDoc>(COLL.crops).findOne({ _id: cropId });
  if (!crop) throw new Error("That crop no longer exists.");
  if (await db.collection(COLL.products).findOne({ crop_id: cropId, name: n })) throw new Error(`${crop.name} already has a product called "${n}".`);
  const now = new Date();
  const productId = (await db.collection(COLL.products).insertOne({ crop_id: cropId, name: n, form: form === "processed" ? "processed" : "raw", price_unit: "Rs/quintal", active: true, created_at: now, updated_at: now })).insertedId;
  await writeAudit(db, user, { action: "product.create", summary: `Added product ${n} to ${crop.name}`, target: { crop_id: cropId, product_id: productId } });
  return productId;
}

export async function updateCrop(db: Db, user: SessionUser, cropId: ObjectId, input: { name?: string; notes?: string; defaultProductId?: ObjectId | null; active?: boolean }) {
  const crops = db.collection<CropDoc>(COLL.crops);
  const before = await crops.findOne({ _id: cropId });
  if (!before) throw new Error("That crop no longer exists.");
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (input.name !== undefined) {
    const n = normName(input.name);
    if (!n) throw new Error("Give the crop a name.");
    const clash = await crops.findOne({ name: n, _id: { $ne: cropId } });
    if (clash) throw new Error(`A crop called "${n}" already exists.`);
    set.name = n;
  }
  if (input.notes !== undefined) set.notes = input.notes.trim() || null;
  if (input.active !== undefined) set.active = input.active;
  if (input.defaultProductId !== undefined) {
    if (input.defaultProductId) {
      const p = await db.collection<ProductDoc>(COLL.products).findOne({ _id: input.defaultProductId, crop_id: cropId });
      if (!p) throw new Error("The default product must belong to this crop.");
    }
    set.default_product_id = input.defaultProductId;
  }
  await crops.updateOne({ _id: cropId }, { $set: set });
  await writeAudit(db, user, {
    action: "crop.update", summary: `Updated crop ${before.name}`, target: { crop_id: cropId },
    before: { name: before.name, notes: before.notes ?? null, default_product_id: before.default_product_id, active: before.active }, after: set,
  });
}

export async function updateProduct(db: Db, user: SessionUser, productId: ObjectId, input: { name?: string; form?: string; active?: boolean }) {
  const products = db.collection<ProductDoc>(COLL.products);
  const before = await products.findOne({ _id: productId });
  if (!before) throw new Error("That product no longer exists.");
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (input.name !== undefined) {
    const n = normName(input.name);
    if (!n) throw new Error("Give the product a name.");
    if (await products.findOne({ crop_id: before.crop_id, name: n, _id: { $ne: productId } })) throw new Error(`This crop already has a product called "${n}".`);
    set.name = n;
  }
  if (input.form !== undefined) set.form = input.form === "processed" ? "processed" : "raw";
  if (input.active !== undefined) set.active = input.active;
  await products.updateOne({ _id: productId }, { $set: set });
  await writeAudit(db, user, { action: "product.update", summary: `Updated product ${before.name}`, target: { product_id: productId }, before, after: set });
}

// ── Mandi name links ────────────────────────────────────────────────────────

export async function decideMandiName(
  db: Db,
  user: SessionUser,
  id: ObjectId,
  decision: { status: Status; mandiId?: ObjectId | null; notes?: string },
) {
  const coll = db.collection<MandiNameDoc>(COLL.mandiNames);
  const row = await coll.findOne({ _id: id });
  if (!row) throw new Error("That mandi name no longer exists.");
  let mandiName: string | null = null;
  if (decision.status === "approved") {
    if (!decision.mandiId) throw new Error("Choose a mandi to approve the link.");
    const mandi = await db.collection(COLL.mandis).findOne({ _id: decision.mandiId });
    if (!mandi) throw new Error("That mandi no longer exists.");
    mandiName = String(mandi.name ?? "");
  }
  const mandiId = decision.status === "approved" ? decision.mandiId! : null;
  await coll.updateOne(
    { _id: id },
    { $set: { status: decision.status, mandi_id: mandiId, decided_by: user.name, decided_at: new Date(), needs_check: false, notes: decision.notes?.trim() || row.notes || null } },
  );
  const filter = { source_system: sameText(row.source), state_code: row.state_code ?? null, market_name: sameText(row.raw_name) };
  const res = await db.collection(COLL.listings).updateMany(filter, { $set: { mandi_id: mandiId } });
  await writeAudit(db, user, {
    action: `mandi_name.${decision.status}`,
    summary:
      decision.status === "approved"
        ? `Approved mandi name "${row.raw_name}" (${row.source}, ${row.state_code ?? "no state"}) as ${mandiName}`
        : `${decision.status === "rejected" ? "Rejected" : "Reopened"} mandi name "${row.raw_name}"`,
    target: { mandi_name_id: id, source: row.source, state_code: row.state_code, raw_name: row.raw_name },
    before: { status: row.status, mandi_id: row.mandi_id },
    after: { status: decision.status, mandi_id: mandiId },
    counts: { listings: res.modifiedCount },
  });
  return { listings: res.modifiedCount, mandiName };
}

// ── Farmer words ────────────────────────────────────────────────────────────

export type CropWordDoc = {
  _id: ObjectId;
  key: string;
  word: string;
  crop_id: ObjectId | null;
  product_id: ObjectId | null;
  status: Status;
  suggestion?: { reason?: string; candidates?: { crop_id: ObjectId; crop_name?: string; sources?: string[] }[] } | null;
  sources?: string[];
  languages?: string[];
  decided_by?: string | null;
  decided_at?: Date | null;
  needs_check?: boolean;
  notes?: string | null;
};

/**
 * Same key as the scraper (catalog.word_key) and the price tool: lower-case, punctuation
 * to spaces, unique words sorted. Splits only on punctuation, symbols and spaces, so
 * Indian scripts keep their combining vowel signs.
 */
export function wordKey(text: string | null | undefined): string {
  const cleaned = (text ?? "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, " ");
  return [...new Set(cleaned.split(/\s+/).filter(Boolean))].sort().join(" ");
}

/** Approve a word for a product (or for a crop, meaning its default product), reject it, or reopen it. */
export async function decideCropWord(
  db: Db,
  user: SessionUser,
  id: ObjectId,
  decision: { status: Status; productId?: ObjectId | null; notes?: string },
) {
  const coll = db.collection<CropWordDoc>(COLL.cropWords);
  const row = await coll.findOne({ _id: id });
  if (!row) throw new Error("That word no longer exists.");
  let cropId: ObjectId | null = null;
  let label = "";
  if (decision.status === "approved") {
    if (!decision.productId) throw new Error("Choose the product this word means.");
    const p = await db.collection<ProductDoc>(COLL.products).findOne({ _id: decision.productId });
    if (!p) throw new Error("That product no longer exists.");
    cropId = p.crop_id;
    label = p.name;
  }
  await coll.updateOne(
    { _id: id },
    {
      $set: {
        status: decision.status,
        crop_id: decision.status === "approved" ? cropId : row.crop_id,
        product_id: decision.status === "approved" ? decision.productId! : null,
        decided_by: user.name, decided_at: new Date(), needs_check: false,
        notes: decision.notes?.trim() || row.notes || null,
      },
    },
  );
  await writeAudit(db, user, {
    action: `crop_word.${decision.status}`,
    summary: decision.status === "approved" ? `Approved farmer word "${row.word}" as ${label}` : `${decision.status === "rejected" ? "Rejected" : "Reopened"} farmer word "${row.word}"`,
    target: { crop_word_id: id, word: row.word },
    before: { status: row.status, crop_id: row.crop_id, product_id: row.product_id },
    after: { status: decision.status, crop_id: cropId, product_id: decision.productId ?? null },
  });
  return label;
}

export async function addCropWord(db: Db, user: SessionUser, word: string, productId: ObjectId, language?: string) {
  const key = wordKey(word);
  if (!key) throw new Error("Type the word.");
  const p = await db.collection<ProductDoc>(COLL.products).findOne({ _id: productId });
  if (!p) throw new Error("That product no longer exists.");
  const coll = db.collection<CropWordDoc>(COLL.cropWords);
  const existing = await coll.findOne({ key });
  if (existing) throw new Error(`"${existing.word}" is already in the list (${existing.status}). Open it to change it.`);
  const now = new Date();
  const doc = {
    key, word: word.trim().toLowerCase().replace(/\s+/g, " "), crop_id: p.crop_id, product_id: productId,
    status: "approved" as Status, suggestion: null, sources: ["review_app"], languages: language?.trim() ? [language.trim()] : [],
    decided_by: user.name, decided_at: now, needs_check: false, notes: null, created_at: now,
  };
  const res = await coll.insertOne(doc as never);
  await writeAudit(db, user, { action: "crop_word.add", summary: `Added farmer word "${doc.word}" for ${p.name}`, target: { crop_word_id: res.insertedId }, after: doc });
}

// ── States ──────────────────────────────────────────────────────────────────

export async function addStateSpelling(db: Db, user: SessionUser, code: string, spelling: string) {
  const s = normName(spelling);
  if (!s) throw new Error("Type the spelling to add.");
  const states = db.collection<StateDoc>(COLL.states);
  const owner = await states.findOne({ spellings: s });
  if (owner && owner._id !== code) throw new Error(`"${s}" already belongs to ${owner.name}.`);
  const target = await states.findOne({ _id: code });
  if (!target) throw new Error("That state no longer exists.");
  await states.updateOne({ _id: code }, { $addToSet: { spellings: s } });
  const res = await db.collection(COLL.listings).updateMany({ state: sameText(s), state_code: null }, { $set: { state_code: code } });
  await db.collection(COLL.review).updateMany(
    { key: `unknown_state|${s}`, status: "open" },
    { $set: { status: "resolved", resolved_by: user.name, resolved_at: new Date(), resolution: { action: "spelling_added", state_code: code } } },
  );
  await writeAudit(db, user, { action: "state.add_spelling", summary: `Added spelling "${s}" to ${target.name}`, target: { state_code: code, spelling: s }, counts: { listings: res.modifiedCount } });
  return { listings: res.modifiedCount };
}

export async function stateSpellings(db: Db, code: string | null | undefined): Promise<string[]> {
  if (!code) return [];
  const s = await db.collection<StateDoc>(COLL.states).findOne({ _id: code });
  return s ? [...new Set([s.name, ...s.spellings])] : [];
}

// ── Summary numbers ─────────────────────────────────────────────────────────

export async function linkCounts(db: Db) {
  const count = (coll: string, f: Record<string, unknown>) => db.collection(coll).countDocuments(f, { maxTimeMS: MAX_TIME_MS });
  const [cropPending, cropCheck, mandiPending, mandiCheck, wordPending, wordCheck] = await Promise.all([
    count(COLL.cropNames, { status: "pending" }),
    count(COLL.cropNames, { status: "approved", needs_check: true }),
    count(COLL.mandiNames, { status: "pending" }),
    count(COLL.mandiNames, { status: "approved", needs_check: true }),
    count(COLL.cropWords, { status: "pending" }),
    count(COLL.cropWords, { status: "approved", needs_check: true }),
  ]);
  return { cropPending, cropCheck, mandiPending, mandiCheck, wordPending, wordCheck };
}
