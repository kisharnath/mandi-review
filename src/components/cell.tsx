import Link from "next/link";
import type { Column } from "@/lib/collections";
import { COLL } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtNumber, titleCase } from "@/lib/format";
import { Badge } from "./ui";

export function getPath(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), row);
}

/** Render one table cell, with links into the matching/mandi/group pages where useful. */
export function Cell({ row, col, collection, groupNames, mandiNames }: {
  row: Record<string, unknown>;
  col: Column;
  collection: string;
  groupNames: Record<string, string>;
  mandiNames: Record<string, string>;
}) {
  const v = getPath(row, col.key);
  if (v === null || v === undefined || v === "") {
    if (col.kind === "group") return <Badge tone="amber">No group</Badge>;
    if (col.kind === "mandi") return <Badge tone="blue">Not linked</Badge>;
    return <span className="text-zinc-300">—</span>;
  }

  if (col.kind === "group") {
    return <Link className="text-emerald-800 hover:underline" href={`/groups/${String(v)}`}>{titleCase(groupNames[String(v)] ?? "(missing group)")}</Link>;
  }
  if (col.kind === "mandi") {
    return <Link className="text-emerald-800 hover:underline" href={`/mandis/${String(v)}`}>{titleCase(mandiNames[String(v)] ?? "(missing mandi)")}</Link>;
  }
  if (col.key.endsWith("commodity_name")) {
    return <Link className="font-medium text-zinc-900 hover:text-emerald-700 hover:underline" href={`/mapping?name=${encodeURIComponent(String(v))}`}>{String(v)}</Link>;
  }
  if (collection === COLL.mandis && col.key === "name") {
    return <Link className="font-medium text-zinc-900 hover:text-emerald-700 hover:underline" href={`/mandis/${String(row._id)}`}>{titleCase(String(v))}</Link>;
  }
  if (collection === COLL.groups && col.key === "canonical_name") {
    return <Link className="font-medium text-zinc-900 hover:text-emerald-700 hover:underline" href={`/groups/${String(row._id)}`}>{titleCase(String(v))}</Link>;
  }

  switch (col.kind) {
    case "number":
      return <span className="tabular-nums">{typeof v === "number" ? fmtNumber(v) : String(v)}</span>;
    case "date":
      return <span className="whitespace-nowrap">{fmtDate(String(v))}</span>;
    case "datetime":
      return <span className="whitespace-nowrap text-zinc-600">{fmtDateTime(String(v))}</span>;
    case "bool":
      return v ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>;
    case "id":
      return <span className="font-mono text-xs text-zinc-500">{String(v)}</span>;
    case "list": {
      const arr = Array.isArray(v) ? v : [v];
      const text = arr.map(String).join(", ");
      return <span className="block max-w-xs truncate text-xs text-zinc-600" title={text}>{text}</span>;
    }
    case "json":
      return <code className="text-xs text-zinc-600">{JSON.stringify(v)}</code>;
    default:
      if (typeof v === "object") return <code className="text-xs text-zinc-600">{JSON.stringify(v).slice(0, 80)}</code>;
      return <span className="block max-w-sm break-words">{String(v)}</span>;
  }
}
