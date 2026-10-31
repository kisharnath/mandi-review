import { ObjectId } from "mongodb";

/** Turn Mongo values into plain JSON-safe values (ObjectId → string, Date → ISO). */
export function plain<T = unknown>(value: unknown): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (v && typeof v === "object" && v._bsontype === "ObjectId") return String(v);
      return v;
    }),
  ) as T;
}

export function toObjectId(id: string | null | undefined): ObjectId | null {
  if (!id || !ObjectId.isValid(id) || String(new ObjectId(id)) !== id.toLowerCase()) return null;
  return new ObjectId(id);
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normName(text: string | null | undefined): string {
  return (text ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN").format(n);
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

export function titleCase(text: string | null | undefined): string {
  return (text ?? "").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** YYYY-MM-DD in UTC (price records are stored at UTC midnight). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dayRange(day: string): { $gte: Date; $lt: Date } {
  const start = new Date(`${day}T00:00:00.000Z`);
  return { $gte: start, $lt: new Date(start.getTime() + 86_400_000) };
}

export function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}
