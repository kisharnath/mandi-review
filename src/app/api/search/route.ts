import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, titleCase } from "@/lib/format";

/** Search crop groups or mandis for the picker dropdowns. */
export async function GET(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const kind = req.nextUrl.searchParams.get("kind");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const state = (req.nextUrl.searchParams.get("state") ?? "").trim();
  const db = await getDb();
  const rx = q ? { $regex: escapeRegex(q), $options: "i" } : undefined;

  if (kind === "groups") {
    const docs = await db
      .collection(COLL.groups)
      .find(rx ? { $or: [{ canonical_name: rx }, { aliases: rx }] } : {}, { projection: { canonical_name: 1, aliases: 1, active: 1 } })
      .sort({ canonical_name: 1 })
      .limit(40)
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    // Groups whose own name matches come first.
    const lower = q.toLowerCase();
    docs.sort((a, b) => Number(!String(a.canonical_name ?? "").toLowerCase().includes(lower)) - Number(!String(b.canonical_name ?? "").toLowerCase().includes(lower)));
    return NextResponse.json({
      items: docs.map((d) => ({
        id: String(d._id),
        label: titleCase(d.canonical_name ?? "(no name)") + (d.active === false ? " (off)" : ""),
        sub: (d.aliases ?? []).slice(0, 6).join(", "),
      })),
    });
  }

  if (kind === "mandis") {
    const filter: Record<string, unknown> = {};
    if (rx) filter.$or = [{ name: rx }, { aliases: rx }, { district: rx }, { postcode: rx }];
    if (state) filter.state = { $regex: `^${escapeRegex(state)}$`, $options: "i" };
    const docs = await db
      .collection(COLL.mandis)
      .find(filter, { projection: { name: 1, state: 1, district: 1, postcode: 1 } })
      .sort({ name: 1 })
      .limit(40)
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    return NextResponse.json({
      items: docs.map((d) => ({
        id: String(d._id),
        label: titleCase(d.name),
        sub: [titleCase(d.district), titleCase(d.state), d.postcode].filter(Boolean).join(" · "),
      })),
    });
  }

  return NextResponse.json({ error: "kind must be groups or mandis" }, { status: 400 });
}
