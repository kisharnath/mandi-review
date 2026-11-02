import clsx from "clsx";
import { deletePricesAction, editPriceAction } from "@/app/actions";
import { DateFilter, FilterSelect, SelectAll, SubmitButton, Tabs } from "@/components/client";
import { Pagination } from "@/components/pagination";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { COLL, getDb } from "@/lib/db";
import { first, fmtDate, fmtNumber, titleCase } from "@/lib/format";
import { cachedBadPriceIndex, countsFromIndex, isProblem, listBadPrices, MAX_DELETE_ALL, PRICE_PROBLEMS, PROBLEM_KEYS, problemsOf, type PriceProblem } from "@/lib/prices";

export const maxDuration = 60;
const PAGE = 100;

const fmtPrice = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtNumber(v));

export default async function WrongPricesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const admin = user.role === "admin";
  const problemParam = first(sp.problem);
  const problem: PriceProblem | undefined = isProblem(problemParam) ? problemParam : undefined;
  const state = first(sp.state) || undefined;
  const date = first(sp.date) || undefined;
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const db = await getDb();
  const [index, states] = await Promise.all([
    cachedBadPriceIndex(),
    db.collection<{ _id: string; name: string }>(COLL.states).find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray(),
  ]);
  const counts = countsFromIndex(index);
  const { rows, total } = await listBadPrices(db, { problem, state, date }, page, PAGE, index);
  const countOf = (k: PriceProblem) => counts[k] ?? 0;
  const allCount = PROBLEM_KEYS.reduce((n, k) => n + countOf(k), 0);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/prices${qs.size ? `?${qs}` : ""}`;
  const scope = [problem ? PRICE_PROBLEMS[problem].label.toLowerCase() : "any problem", state && titleCase(states.find((s) => s._id === state)?.name ?? state), date && fmtDate(date)]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        title="Wrong prices"
        description="Prices that cannot be right. Fix a price with Edit, or tick rows and delete them. Every deleted price is copied to the deleted-prices collection first, and every change is in the change history."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="problem"
          tabs={[
            { value: "", label: "All", count: allCount },
            ...PROBLEM_KEYS.map((k) => ({ value: k, label: PRICE_PROBLEMS[k].label, count: countOf(k) })),
          ]}
        />
        <FilterSelect param="state" label="State" options={states.map((s) => ({ value: s._id, label: titleCase(s.name) }))} />
        <DateFilter param="date" label="Day" />
      </div>
      {problem && (
        <p className={problem === "modal_missing" ? "mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" : "mb-4 text-sm text-zinc-600"}>
          {titleCase(PRICE_PROBLEMS[problem].hint.slice(0, 1))}{PRICE_PROBLEMS[problem].hint.slice(1)}.
        </p>
      )}

      {rows.length === 0 ? (
        <Empty title="No wrong prices here">Nothing matches {scope}.</Empty>
      ) : (
        <>
          {editor && (
            <form id="bulk" action={deletePricesAction} className="card mb-3 flex flex-wrap items-center gap-3 px-4 py-2.5">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="problem" value={problem ?? ""} />
              <input type="hidden" name="state" value={state ?? ""} />
              <input type="hidden" name="date" value={date ?? ""} />
              <span className="text-sm text-zinc-600">With ticked prices:</span>
              <input name="reason" className="input max-w-xs py-1" placeholder="Reason (optional)" />
              <SubmitButton className="btn-danger" confirm="Delete the ticked prices? A copy of each is kept.">Delete ticked</SubmitButton>
              {admin && problem && PRICE_PROBLEMS[problem].deleteAll && total <= MAX_DELETE_ALL && (
                <SubmitButton
                  className="btn-secondary"
                  name="all"
                  value="1"
                  confirm={`Delete all ${total} prices with ${scope}? A copy of each is kept.`}
                >
                  Delete all {fmtNumber(total)} matching
                </SubmitButton>
              )}
            </form>
          )}
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  {editor && <th className="w-8"><SelectAll name="ids" form="bulk" /></th>}
                  <th>Day</th>
                  <th>Crop</th>
                  <th>Mandi</th>
                  <th>Source</th>
                  <th className="text-right">Min ₹</th>
                  <th className="text-right">Max ₹</th>
                  <th className="text-right">Modal ₹</th>
                  <th>Problem</th>
                  {editor && <th className="w-[14rem]">Edit</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const probs = problemsOf(r);
                  const bad = (field: "min" | "max" | "modal") =>
                    (probs.includes("zero") && (r[`${field}_price`] ?? 1) <= 0) ||
                    (probs.includes("min_above_max") && field !== "modal") ||
                    (probs.includes("modal_outside") && field === "modal") ||
                    (probs.includes("modal_missing") && field === "modal") ||
                    probs.includes("no_price");
                  const cell = (field: "min" | "max" | "modal") => (
                    <td className={clsx("text-right tabular-nums", bad(field) && "font-semibold text-red-700")}>{fmtPrice(r[`${field}_price`])}</td>
                  );
                  const id = String(r._id);
                  return (
                    <tr key={id}>
                      {editor && (
                        <td><input type="checkbox" name="ids" value={id} form="bulk" className="h-4 w-4 accent-emerald-700" aria-label={`Select ${r.mc?.commodity_name ?? "price"}`} /></td>
                      )}
                      <td className="text-xs whitespace-nowrap text-zinc-600">{fmtDate(r.date)}</td>
                      <td>
                        <div className="font-medium text-zinc-900">{r.mc?.commodity_name ?? "—"}</div>
                        {r.mc?.variety && <div className="text-xs text-zinc-500">{r.mc.variety}</div>}
                      </td>
                      <td>
                        <div className="text-zinc-800">{titleCase(r.mc?.market_name)}</div>
                        <div className="text-xs text-zinc-500">{titleCase(r.mc?.state)}</div>
                      </td>
                      <td className="text-xs text-zinc-500">{r.mc?.source_system}</td>
                      {cell("min")}
                      {cell("max")}
                      {cell("modal")}
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {probs.map((p) => <Badge key={p} tone="red">{PRICE_PROBLEMS[p].label}</Badge>)}
                          {r.edited_by && <Badge tone="blue">edited by {r.edited_by}</Badge>}
                        </div>
                      </td>
                      {editor && (
                        <td>
                          <details>
                            <summary className="cursor-pointer text-sm font-medium text-emerald-700">Edit</summary>
                            <form action={editPriceAction} className="mt-2 grid grid-cols-3 items-end gap-1.5">
                              <input type="hidden" name="back" value={back} />
                              <input type="hidden" name="id" value={id} />
                              {(["min", "max", "modal"] as const).map((f) => (
                                <label key={f} className="text-xs text-zinc-500">
                                  {f}
                                  <input name={f} type="number" step="any" min="0" defaultValue={r[`${f}_price`] ?? ""} className="input w-full px-1.5 py-1" required={f === "modal"} />
                                </label>
                              ))}
                              <div className="col-span-3"><SubmitButton>Save</SubmitButton></div>
                            </form>
                          </details>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE} total={total} />
        </>
      )}
    </>
  );
}
