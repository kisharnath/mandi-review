"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function Pagination({ page, pageSize, total, estimate }: { page: number; pageSize: number; total: number; estimate?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = total >= 0 ? Math.max(1, Math.ceil(total / pageSize)) : page + 1;
  const href = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.delete("msg");
    next.delete("err");
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    return `${pathname}?${next}`;
  };
  const from = (page - 1) * pageSize + 1;
  const to = total >= 0 ? Math.min(total, page * pageSize) : page * pageSize;

  return (
    <div className="mt-3 flex items-center justify-between text-sm text-zinc-600">
      <span className="tabular-nums">
        {total === 0 ? "No rows" : `${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${total >= 0 ? `${estimate ? "about " : ""}${total.toLocaleString("en-IN")}` : "many"}`}
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn-secondary px-2" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Link>
        ) : (
          <span className="btn-secondary px-2 opacity-40"><ChevronLeft className="h-4 w-4" /></span>
        )}
        <span className="px-2 tabular-nums">Page {page} of {pages.toLocaleString("en-IN")}</span>
        {page < pages ? (
          <Link href={href(page + 1)} className="btn-secondary px-2" aria-label="Next page"><ChevronRight className="h-4 w-4" /></Link>
        ) : (
          <span className="btn-secondary px-2 opacity-40"><ChevronRight className="h-4 w-4" /></span>
        )}
      </div>
    </div>
  );
}
