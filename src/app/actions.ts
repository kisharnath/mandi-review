"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkLogin, requireEditor } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { COLL, getDb } from "@/lib/db";
import { toObjectId } from "@/lib/format";
import {
  addStateSpelling, addVarietyLink, createCrop, createProduct, decideCropName, decideMandiName, updateCrop, updateProduct,
  type Status,
} from "@/lib/catalog";
import { createMandi, updateMandi } from "@/lib/mandis";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

/** Only allow redirects back into this site. */
function safeBack(value: FormDataEntryValue | null, fallback = "/"): string {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

function withFlash(back: string, msg?: string, err?: string): string {
  const url = new URL(back, "http://x");
  url.searchParams.delete("msg");
  url.searchParams.delete("err");
  if (msg) url.searchParams.set("msg", msg);
  if (err) url.searchParams.set("err", err);
  return url.pathname + url.search;
}

/** Run a change, then go back to the page with a success or error message. */
async function act(form: FormData, work: () => Promise<string>): Promise<never> {
  const back = safeBack(form.get("back"));
  let msg: string | undefined;
  let err: string | undefined;
  try {
    msg = await work();
    revalidatePath("/", "layout");
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  redirect(withFlash(back, msg, err));
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => (str(form, key) === "" ? undefined : Number(str(form, key)));

function needId(form: FormData, key: string, what: string) {
  const id = toObjectId(str(form, key));
  if (!id) throw new Error(`Choose a ${what} first.`);
  return id;
}

// ── Sign in / out ────────────────────────────────────────────────────────────

export async function login(form: FormData) {
  const next = safeBack(form.get("next"));
  const user = checkLogin(str(form, "name"), String(form.get("password") ?? ""));
  if (!user) redirect(`/login?err=${encodeURIComponent("Wrong name or password.")}&next=${encodeURIComponent(next)}`);
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
  });
  redirect(next);
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

// ── Crop name links ──────────────────────────────────────────────────────────

function status(form: FormData): Status {
  const v = str(form, "status");
  if (v !== "approved" && v !== "rejected" && v !== "pending") throw new Error("Unknown decision.");
  return v;
}

export async function decideCropNameAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const s = status(form);
    const res = await decideCropName(await getDb(), user, needId(form, "id", "crop name"), {
      status: s, productId: s === "approved" ? needId(form, "productId", "product") : null, notes: str(form, "notes"),
    });
    return s === "approved"
      ? `Approved as ${res.productName}. ${res.listings} listings updated.`
      : s === "rejected" ? `Rejected. ${res.listings} listings no longer show a price.` : "Moved back to pending.";
  });
}

export async function addVarietyAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    await addVarietyLink(await getDb(), user, needId(form, "id", "crop name"), str(form, "variety"));
    return "Variety added as a pending link. Approve it to give that variety its own product.";
  });
}

// ── Crops and products ───────────────────────────────────────────────────────

export async function createCropAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const db = await getDb();
    const { productId } = await createCrop(db, user, str(form, "name"), str(form, "notes"));
    const linkId = toObjectId(str(form, "linkId"));
    if (linkId) {
      const res = await decideCropName(db, user, linkId, { status: "approved", productId });
      return `Crop created and the name approved for it (${res.listings} listings).`;
    }
    return "Crop created with a default product of the same name.";
  });
}

export async function createProductAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const db = await getDb();
    const productId = await createProduct(db, user, needId(form, "cropId", "crop"), str(form, "name"), str(form, "form"));
    const linkId = toObjectId(str(form, "linkId"));
    if (linkId) {
      const res = await decideCropName(db, user, linkId, { status: "approved", productId });
      return `Product created and the name approved for it (${res.listings} listings).`;
    }
    return "Product added.";
  });
}

export async function updateCropAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const has = (k: string) => form.has(k);
    await updateCrop(await getDb(), user, needId(form, "cropId", "crop"), {
      name: has("name") ? str(form, "name") : undefined,
      notes: has("notes") ? str(form, "notes") : undefined,
      defaultProductId: has("defaultProductId") ? toObjectId(str(form, "defaultProductId")) : undefined,
      active: has("active") ? str(form, "active") === "true" : undefined,
    });
    return "Crop saved.";
  });
}

export async function updateProductAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const has = (k: string) => form.has(k);
    await updateProduct(await getDb(), user, needId(form, "productId", "product"), {
      name: has("name") ? str(form, "name") : undefined,
      form: has("form") ? str(form, "form") : undefined,
      active: has("active") ? str(form, "active") === "true" : undefined,
    });
    return "Product saved.";
  });
}

// ── Mandi name links and mandis ─────────────────────────────────────────────

export async function decideMandiNameAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const s = status(form);
    const res = await decideMandiName(await getDb(), user, needId(form, "id", "mandi name"), {
      status: s, mandiId: s === "approved" ? needId(form, "mandiId", "mandi") : null, notes: str(form, "notes"),
    });
    return s === "approved" ? `Approved as ${res.mandiName}. ${res.listings} listings updated.` : s === "rejected" ? "Rejected." : "Moved back to pending.";
  });
}

export async function createMandiAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const db = await getDb();
    const id = await createMandi(db, user, {
      name: str(form, "name"), state: str(form, "state"), district: str(form, "district"), postcode: str(form, "postcode"),
      lat: num(form, "lat"), lon: num(form, "lon"),
    });
    const linkId = toObjectId(str(form, "linkId"));
    if (linkId) {
      const res = await decideMandiName(db, user, linkId, { status: "approved", mandiId: id });
      return `Mandi created and the name approved for it (${res.listings} listings).`;
    }
    return "Mandi created.";
  });
}

export async function updateMandiAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    await updateMandi(await getDb(), user, needId(form, "mandiId", "mandi"), {
      district: str(form, "district"), postcode: str(form, "postcode"), lat: num(form, "lat"), lon: num(form, "lon"),
    });
    return "Mandi saved.";
  });
}

// ── States ──────────────────────────────────────────────────────────────────

export async function addStateSpellingAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const res = await addStateSpelling(await getDb(), user, str(form, "code"), str(form, "spelling"));
    return `Spelling added. ${res.listings} listings now have this state.`;
  });
}

// ── Review list ──────────────────────────────────────────────────────────────

export async function setReviewStatusAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const status = str(form, "status");
    if (!["open", "resolved", "ignored"].includes(status)) throw new Error("Unknown status.");
    const ids = form.getAll("ids").map((v) => toObjectId(String(v))).filter((v) => v !== null);
    if (!ids.length) throw new Error("Tick at least one item first.");
    const note = str(form, "note");
    const db = await getDb();
    const set =
      status === "open"
        ? { $set: { status }, $unset: { resolved_by: "", resolved_at: "", resolution: "" } }
        : { $set: { status, resolved_by: user.name, resolved_at: new Date(), resolution: { action: status, note: note || null } } };
    const res = await db.collection(COLL.review).updateMany({ _id: { $in: ids } }, set);
    await writeAudit(db, user, {
      action: `review.${status}`,
      summary: `Marked ${res.modifiedCount} review item(s) as ${status}${note ? `: ${note}` : ""}`,
      target: { ids },
      counts: { items: res.modifiedCount },
    });
    return `${res.modifiedCount} item(s) marked as ${status}.`;
  });
}
