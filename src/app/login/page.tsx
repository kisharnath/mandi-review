import { Sprout } from "lucide-react";
import { redirect } from "next/navigation";
import { login } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { currentUser } from "@/lib/auth";
import { first } from "@/lib/format";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = first(sp.next) || "/";
  if (await currentUser()) redirect(next.startsWith("/") ? next : "/");
  const err = first(sp.err);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <Sprout className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Mandi Data Review</h1>
            <p className="text-sm text-zinc-500">Sign in to continue</p>
          </div>
        </div>
        {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
        <form action={login} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" autoComplete="username" required autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
          </div>
          <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
        </form>
      </div>
    </main>
  );
}
