import { unstable_cache } from "next/cache";
import { logout } from "@/app/actions";
import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/auth";
import { COLL, getDb } from "@/lib/db";

/** Items waiting for a person, for the menu badge. Cached a minute; any change on the site clears it. */
const openItemCount = unstable_cache(
  async () => {
    const db = await getDb();
    const counts = await Promise.all(
      [
        db.collection(COLL.review).countDocuments({ status: "open" }, { maxTimeMS: 5000 }),
        db.collection(COLL.cropNames).countDocuments({ status: "pending" }, { maxTimeMS: 5000 }),
        db.collection(COLL.mandiNames).countDocuments({ status: "pending" }, { maxTimeMS: 5000 }),
        db.collection(COLL.cropWords).countDocuments({ status: "pending" }, { maxTimeMS: 5000 }),
      ].map((p) => p.catch(() => 0)),
    );
    return counts.reduce((a, b) => a + b, 0);
  },
  ["open-item-count"],
  { revalidate: 60, tags: ["badges"] },
);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, openCount] = await Promise.all([requireUser(), openItemCount()]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Nav user={user} openCount={openCount} logout={logout} mandisCollection={COLL.mandis} auditCollection={COLL.audit} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
