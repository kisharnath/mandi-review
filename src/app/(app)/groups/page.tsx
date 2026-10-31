import Link from "next/link";
import { createGroupAction } from "@/app/actions";
import { SearchBox, SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { first, fmtNumber, titleCase } from "@/lib/format";
import { listGroups } from "@/lib/mapping";

export const maxDuration = 60;

export default async function GroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const q = first(sp.q);
  const groups = await listGroups(await getDb(), q);

  return (
    <>
      <PageHeader
        title="Crop groups"
        description="Each crop group collects the different names mandis use for one crop. Open a group to see and fix its names."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search group or name…" />
        {canEdit(user) && (
          <details className="relative">
            <summary className="btn-primary cursor-pointer list-none">New crop group</summary>
            <form action={createGroupAction} className="card absolute right-0 z-20 mt-2 w-80 space-y-3 p-4">
              <input type="hidden" name="back" value="/groups" />
              <div>
                <label className="label" htmlFor="canonical">Name</label>
                <input id="canonical" name="canonical" className="input" required placeholder="e.g. green chilli" />
              </div>
              <div>
                <label className="label" htmlFor="notes">Note (optional)</label>
                <input id="notes" name="notes" className="input" />
              </div>
              <SubmitButton>Create</SubmitButton>
            </form>
          </details>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Crop group</th><th>Names in this group</th><th className="text-right">Listings</th><th /></tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const names = [...new Set([...g.aliases, ...g.namesInUse])];
              return (
                <tr key={g.id}>
                  <td className="font-medium whitespace-nowrap">
                    <Link className="text-zinc-900 hover:text-emerald-700 hover:underline" href={`/groups/${g.id}`}>{titleCase(g.name)}</Link>
                    {!g.active && <span className="ml-2"><Badge>Off</Badge></span>}
                  </td>
                  <td className="text-xs text-zinc-600">
                    {names.slice(0, 12).join(", ")}
                    {names.length > 12 && <span className="text-zinc-400"> … +{names.length - 12}</span>}
                  </td>
                  <td className="text-right tabular-nums">{fmtNumber(g.listings)}</td>
                  <td className="text-right"><Link className="text-xs font-medium text-emerald-700 hover:underline" href={`/groups/${g.id}`}>Open →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{fmtNumber(groups.length)} groups</p>
    </>
  );
}
