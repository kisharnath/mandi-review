import { logout } from "@/app/actions";
import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/auth";
import { COLL, getDb } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [problems, pendingCrops, pendingMandis] = await Promise.all(
    [
      db.collection(COLL.review).countDocuments({ status: "open" }, { maxTimeMS: 5000 }),
      db.collection(COLL.cropNames).countDocuments({ status: "pending" }, { maxTimeMS: 5000 }),
      db.collection(COLL.mandiNames).countDocuments({ status: "pending" }, { maxTimeMS: 5000 }),
    ].map((p) => p.catch(() => 0)),
  );
  const openCount = problems + pendingCrops + pendingMandis;

  return (
    <div className="flex h-screen overflow-hidden">
      <Nav user={user} openCount={openCount} logout={logout} mandisCollection={COLL.mandis} auditCollection={COLL.audit} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
