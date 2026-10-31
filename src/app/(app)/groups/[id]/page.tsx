import Link from "next/link";
import { notFound } from "next/navigation";
import { renameGroupAction, setGroupActiveAction, unassignNameAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader, SectionTitle } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { first, fmtDateTime, fmtNumber, titleCase, toObjectId } from "@/lib/format";
import { looksWrong } from "@/lib/heuristics";
import type { GroupDoc } from "@/lib/mapping";

export const maxDuration = 60;

export default async function GroupPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const oid = toObjectId(id);
  if (!oid) notFound();
  const user = await requireUser();
  const editor = canEdit(user);
  const db = await getDb();
  const group = await db.collection<GroupDoc>(COLL.groups).findOne({ _id: oid });
  if (!group) notFound();

  const used = await db
    .collection(COLL.markets)
    .aggregate<{ _id: string; n: number; states: string[] }>(
      [{ $match: { commodity_alias_lookup_id: oid } }, { $group: { _id: "$commodity_name", n: { $sum: 1 }, states: { $addToSet: "$state" } } }, { $sort: { n: -1 } }],
      { maxTimeMS: MAX_TIME_MS },
    )
    .toArray();
  const usedBy = new Map(used.map((u) => [u._id, u]));
  const names = [...new Set([...(group.aliases ?? []), ...used.map((u) => u._id).filter(Boolean)])].sort(
    (a, b) => (usedBy.get(b)?.n ?? 0) - (usedBy.get(a)?.n ?? 0) || a.localeCompare(b),
  );
  const back = `/groups/${id}`;

  return (
    <>
      <PageHeader
        title={titleCase(group.canonical_name)}
        description="All names that mandis use for this crop group. A name marked “looks wrong” probably belongs to a different crop."
        actions={<Link href="/groups" className="btn-secondary">← All groups</Link>}
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Name</th><th className="text-right">Listings</th><th>States</th><th /></tr>
              </thead>
              <tbody>
                {names.map((n) => {
                  const u = usedBy.get(n);
                  const wrong = looksWrong(n, group.canonical_name, group.aliases);
                  return (
                    <tr key={n}>
                      <td>
                        <Link href={`/mapping?name=${encodeURIComponent(n)}`} className="font-medium text-zinc-900 hover:text-emerald-700 hover:underline">{n}</Link>
                        <div className="mt-0.5 flex gap-1">
                          {wrong && <Badge tone="violet">Looks wrong</Badge>}
                          {!(group.aliases ?? []).includes(n) && <Badge tone="amber" title="Listings point here, but the scraper will not match this name on its next run">Not in name list</Badge>}
                          {!u && <Badge>Not used by any mandi</Badge>}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{fmtNumber(u?.n ?? 0)}</td>
                      <td className="text-xs text-zinc-600">{(u?.states ?? []).filter(Boolean).slice(0, 5).map(titleCase).join(", ")}</td>
                      <td className="text-right whitespace-nowrap">
                        <Link className="text-xs font-medium text-emerald-700 hover:underline" href={`/mapping?name=${encodeURIComponent(n)}`}>Move…</Link>
                        {editor && (
                          <form action={unassignNameAction} className="ml-3 inline">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="name" value={n} />
                            <SubmitButton className="text-xs font-medium text-red-700 hover:underline" confirm={`Remove "${n}" from ${group.canonical_name}? Its prices will be hidden until it is matched again.`}>
                              Remove
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5 text-sm">
            <SectionTitle>About this group</SectionTitle>
            <dl className="space-y-1.5 text-zinc-600">
              <div className="flex justify-between"><dt>Status</dt><dd>{group.active === false ? <Badge>Off</Badge> : <Badge tone="green">On</Badge>}</dd></div>
              <div className="flex justify-between"><dt>Names</dt><dd className="tabular-nums">{names.length}</dd></div>
              <div className="flex justify-between"><dt>Listings</dt><dd className="tabular-nums">{fmtNumber(used.reduce((a, u) => a + u.n, 0))}</dd></div>
              <div className="flex justify-between"><dt>Updated</dt><dd>{fmtDateTime(group.updatedAt)}</dd></div>
              <div className="flex justify-between gap-2"><dt>Id</dt><dd className="font-mono text-xs">{id}</dd></div>
            </dl>
            {group.notes && <p className="mt-3 rounded-lg bg-zinc-50 p-2 text-zinc-700">{group.notes}</p>}
          </div>

          {editor && (
            <>
              <form action={renameGroupAction} className="card space-y-3 p-5">
                <SectionTitle>Edit</SectionTitle>
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="groupId" value={id} />
                <div>
                  <label className="label" htmlFor="canonical">Group name</label>
                  <input id="canonical" name="canonical" className="input" defaultValue={group.canonical_name} required />
                </div>
                <div>
                  <label className="label" htmlFor="notes">Note</label>
                  <textarea id="notes" name="notes" className="input min-h-20" defaultValue={group.notes ?? ""} />
                </div>
                <SubmitButton>Save</SubmitButton>
              </form>
              <form action={setGroupActiveAction} className="card p-5">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="groupId" value={id} />
                <input type="hidden" name="active" value={group.active === false ? "true" : "false"} />
                <p className="mb-3 text-sm text-zinc-600">
                  {group.active === false ? "This group is off. Turn it on to use it again." : "Turning a group off keeps its data but marks it as not in use."}
                </p>
                <SubmitButton className="btn-secondary">{group.active === false ? "Turn on" : "Turn off"}</SubmitButton>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}
