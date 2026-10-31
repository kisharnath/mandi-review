"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkLogin, requireEditor } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { COLL, getDb } from "@/lib/db";
import { toObjectId } from "@/lib/format";
import { assignName, createGroup, renameGroup, setGroupActive, unassignName } from "@/lib/mapping";
import { createMandi, linkMandiName, updateMandi } from "@/lib/mandis";
import { scanMapping } from "@/lib/scan";
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

// ── Crop matching ────────────────────────────────────────────────────────────

export async function assignNameAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const groupId = needId(form, "groupId", "crop group");
    const res = await assignName(await getDb(), user, str(form, "name"), groupId);
    return `Matched. ${res.listings} listings and ${res.prices} prices updated.`;
  });
}

export async function unassignNameAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    await unassignName(await getDb(), user, str(form, "name"));
    return "Match removed. Prices for this name are hidden until it is matched again.";
  });
}

export async function createGroupAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const db = await getDb();
    const id = await createGroup(db, user, str(form, "canonical"), str(form, "notes"));
    const name = str(form, "name");
    if (name) {
      const res = await assignName(db, user, name, id);
      return `Crop group created and "${name}" matched to it (${res.listings} listings).`;
    }
    return "Crop group created.";
  });
}

export async function renameGroupAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    await renameGroup(await getDb(), user, needId(form, "groupId", "crop group"), str(form, "canonical"), str(form, "notes"));
    return "Crop group saved.";
  });
}

export async function setGroupActiveAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const active = str(form, "active") === "true";
    await setGroupActive(await getDb(), user, needId(form, "groupId", "crop group"), active);
    return active ? "Crop group turned on." : "Crop group turned off.";
  });
}

// ── Mandis ───────────────────────────────────────────────────────────────────

export async function linkMandiAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const res = await linkMandiName(await getDb(), user, str(form, "name"), str(form, "state"), needId(form, "mandiId", "mandi"));
    return `Mandi name linked. ${res.listings} listings updated.`;
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
    const res = await linkMandiName(db, user, str(form, "name"), str(form, "state"), id);
    return `Mandi created. ${res.listings} listings now point to it.`;
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

export async function scanAction(form: FormData) {
  return act(form, async () => {
    const user = await requireEditor();
    const db = await getDb();
    const res = await scanMapping(db, user.name);
    await writeAudit(db, user, { action: "review.scan", summary: "Scanned current crop matching for problems", counts: res });
    return `Scan done: ${res.unmapped} unmatched names, ${res.suspicious} matches that look wrong, ${res.duplicates} names in more than one group.`;
  });
}
