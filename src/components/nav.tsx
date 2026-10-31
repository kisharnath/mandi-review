"use client";

import clsx from "clsx";
import { Activity, Database, Flag, History, LayoutDashboard, ListChecks, LogOut, MapPin, Shuffle, Signpost, Sprout } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const linksFor = (mandis: string, audit: string) => [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/runs", label: "Scrape runs", icon: Activity },
  { href: "/review", label: "Review list", icon: ListChecks },
  { href: "/mapping", label: "Crop names", icon: Shuffle },
  { href: "/mandi-links", label: "Mandi names", icon: Signpost },
  { href: "/crops", label: "Crops & products", icon: Sprout },
  { href: `/data/${mandis}`, label: "Mandis", icon: MapPin },
  { href: "/state-names", label: "States", icon: Flag },
  { href: "/data", label: "All data", icon: Database },
  { href: `/data/${audit}`, label: "Change history", icon: History },
];

export function Nav({ user, openCount, logout, mandisCollection, auditCollection }: {
  user: { name: string; role: string };
  openCount: number;
  logout: () => Promise<void>;
  mandisCollection: string;
  auditCollection: string;
}) {
  const pathname = usePathname();
  const LINKS = linksFor(mandisCollection, auditCollection);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : href === "/data" ? pathname === "/data" || (pathname.startsWith("/data/") && !LINKS.some((l) => l.href !== "/data" && l.href.startsWith("/data/") && pathname.startsWith(l.href))) : pathname.startsWith(href);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700 text-white">
          <Sprout className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-900">Mandi Data Review</div>
          <div className="text-xs text-zinc-500">v2 · approved name links</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive(href) ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {href === "/review" && openCount > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800 tabular-nums">{openCount}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="border-t border-zinc-200 p-4">
        <div className="text-sm font-medium text-zinc-900">{user.name}</div>
        <div className="text-xs text-zinc-500 capitalize">{user.role}</div>
        <form action={logout}>
          <button className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
