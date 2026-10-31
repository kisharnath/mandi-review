import { addStateSpellingAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash, PageHeader } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import type { StateDoc } from "@/lib/catalog";
import { COLL, getDb } from "@/lib/db";
import { first, fmtNumber, titleCase } from "@/lib/format";

export default async function StateNamesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = await getDb();
  const [states, counts] = await Promise.all([
    db.collection<StateDoc>(COLL.states).find({}).sort({ name: 1 }).toArray(),
    db.collection(COLL.listings).aggregate<{ _id: string | null; n: number }>([{ $group: { _id: "$state_code", n: { $sum: 1 } } }]).toArray(),
  ]);
  const listings = new Map(counts.map((c) => [c._id ?? "", c.n]));

  return (
    <>
      <PageHeader
        title="States"
        description="Each state and every spelling the sources use for it. A listing whose state spelling is not here gets no state, and appears as a problem in the review list."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      {!!listings.get("") && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {fmtNumber(listings.get("") ?? 0)} listings have a state spelling that is not listed below.
        </p>
      )}
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>State</th><th>Code</th><th>Spellings</th><th className="text-right">Listings</th>{canEdit(user) && <th>Add a spelling</th>}</tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <tr key={s._id}>
                <td className="font-medium">{titleCase(s.name)}</td>
                <td className="font-mono text-xs text-zinc-500">{s._id}</td>
                <td className="text-xs text-zinc-600">{s.spellings.join(", ")}</td>
                <td className="text-right tabular-nums">{fmtNumber(listings.get(s._id) ?? 0)}</td>
                {canEdit(user) && (
                  <td>
                    <form action={addStateSpellingAction} className="flex gap-2">
                      <input type="hidden" name="back" value="/state-names" />
                      <input type="hidden" name="code" value={s._id} />
                      <input name="spelling" className="input w-40 py-1" placeholder="e.g. orissa" required />
                      <SubmitButton className="btn-secondary">Add</SubmitButton>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
