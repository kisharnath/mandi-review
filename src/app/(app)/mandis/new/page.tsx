import Link from "next/link";
import { createMandiAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash, PageHeader } from "@/components/ui";
import { requireEditor } from "@/lib/auth";
import { first } from "@/lib/format";

export default async function NewMandiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireEditor();
  const sp = await searchParams;
  const name = first(sp.name);
  const state = first(sp.state);
  const linkId = first(sp.linkId);
  const qs = new URLSearchParams({ name, state, linkId }).toString();

  return (
    <>
      <PageHeader
        title="Add a mandi"
        description="Use this only when the mandi is truly new. If it is an existing mandi under another spelling, approve the mandi name for that mandi instead."
        actions={<Link href="/mandi-links" className="btn-secondary">← Mandi names</Link>}
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      <form action={createMandiAction} className="card grid max-w-2xl gap-4 p-6 sm:grid-cols-2">
        <input type="hidden" name="back" value={`/mandis/new?${qs}`} />
        <input type="hidden" name="linkId" value={linkId} />
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Mandi name (as the source writes it)</label>
          <input id="name" name="name" className="input" defaultValue={name} required />
        </div>
        <div>
          <label className="label" htmlFor="state">State</label>
          <input id="state" name="state" className="input" defaultValue={state} required />
        </div>
        <div>
          <label className="label" htmlFor="district">District</label>
          <input id="district" name="district" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="postcode">Postcode</label>
          <input id="postcode" name="postcode" className="input" inputMode="numeric" />
        </div>
        <div />
        <div>
          <label className="label" htmlFor="lat">Latitude</label>
          <input id="lat" name="lat" className="input" inputMode="decimal" placeholder="17.8213" />
        </div>
        <div>
          <label className="label" htmlFor="lon">Longitude</label>
          <input id="lon" name="lon" className="input" inputMode="decimal" placeholder="83.2065" />
        </div>
        <p className="text-xs text-zinc-500 sm:col-span-2">
          Without a location, the farmer app cannot find this mandi as &quot;near me&quot;. You can add it later.
        </p>
        <div className="sm:col-span-2">
          <SubmitButton>{linkId ? "Add mandi and approve the name for it" : "Add mandi"}</SubmitButton>
        </div>
      </form>
    </>
  );
}
