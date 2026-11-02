import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { COLL } from "@/lib/db";

function Box({ title, children, tone = "zinc" }: { title: string; children: ReactNode; tone?: "zinc" | "emerald" | "amber" | "blue" }) {
  const tones = {
    zinc: "border-zinc-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    blue: "border-sky-200 bg-sky-50",
  };
  return (
    <div className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>
      <div className="font-semibold text-zinc-900">{title}</div>
      <div className="mt-1 text-xs text-zinc-600">{children}</div>
    </div>
  );
}

const Right = () => <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-zinc-400 md:block" />;
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.8em] text-zinc-800">{children}</code>;

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold text-white">{n}</span>
      <div className="text-sm">
        <div className="font-semibold text-zinc-900">{title}</div>
        <div className="mt-0.5 text-zinc-600">{children}</div>
      </div>
    </li>
  );
}

function Json({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-100">{children}</pre>;
}

export default async function HowItWorksPage() {
  await requireUser();

  const collections: { name: string; job: string; writer: string; href?: string }[] = [
    { name: COLL.listings, job: "One row per source + state + mandi + crop name + variety, as the source spells them. Carries product_id and mandi_id once those names are approved.", writer: "Scraper (row); this site (product_id, mandi_id)" },
    { name: COLL.prices, job: "One price per listing per day: min, max, modal price and arrivals. Points only at its listing.", writer: "Scraper", href: `/data/${COLL.prices}` },
    { name: COLL.crops, job: "Crops in plain words, e.g. paddy, onion. Each has a default product.", writer: "This site", href: "/crops" },
    { name: COLL.products, job: "What a price is for, e.g. paddy (raw), basmati paddy, rice (milled). The tool always answers for one product.", writer: "This site", href: "/crops" },
    { name: COLL.cropNames, job: "Each crop spelling a source uses (\"Paddy(Common)\") linked to a product. Pending until a person approves it.", writer: "Scraper adds as pending; people approve", href: "/mapping" },
    { name: COLL.mandiNames, job: "Each mandi spelling a source uses, per state, linked to a mandi in available_mandi.", writer: "Scraper adds as pending; people approve", href: "/mandi-links" },
    { name: COLL.cropWords, job: "Other English names for a crop (dry chillies, blackgram) linked to a product. English only: questions are translated before they reach the tool.", writer: "This site", href: "/crop-words" },
    { name: COLL.states, job: "Each state with all its spellings, so \"Orissa\" and \"Odisha\" are one state.", writer: "This site", href: "/state-names" },
    { name: COLL.mandis, job: "The mandi list with locations. Shared with v1 and never changed by v2 except through this site.", writer: "This site", href: `/data/${COLL.mandis}` },
    { name: COLL.runs, job: "One row per scrape run and source: how many rows came in, what failed.", writer: "Scraper", href: "/runs" },
    { name: COLL.review, job: "Problems found during a run: unknown names, odd prices, failed sources.", writer: "Scraper; closed on this site", href: "/review" },
    { name: COLL.deletedPrices, job: "A copy of every price deleted on the Wrong prices page.", writer: "This site", href: `/data/${COLL.deletedPrices}` },
    { name: COLL.audit, job: "Every change made on this site: who, when, what.", writer: "This site", href: `/data/${COLL.audit}` },
  ];

  return (
    <>
      <PageHeader
        title="How it works"
        description="How mandi prices get from the sources into the database, how the database is laid out, and how the farmer tool finds a price."
      />

      <section className="mb-10">
        <SectionTitle>The big picture</SectionTitle>
        <div className="card p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
            <Box title="Sources">Agmarknet and state portals (UP, Punjab, Andhra Pradesh, Meghalaya, Karnataka…)</Box>
            <Right />
            <Box title="Scraper (daily)">Fetches, cleans and saves every price exactly as the source names it.</Box>
            <Right />
            <Box title="v2 database" tone="blue">Listings and prices, plus name links that say what each source name means.</Box>
            <Right />
            <Box title="This site" tone="amber">People approve or fix the name links. Nothing reaches farmers until a link is approved.</Box>
            <Right />
            <Box title="Farmer tool" tone="emerald">Turns the farmer&apos;s words into one product and one state, and answers with prices for those only.</Box>
          </div>
          <p className="mt-4 text-sm text-zinc-600">
            The key rule: <b>the scraper never guesses what a name means</b>. It saves the name as the source wrote it and adds it here as <i>pending</i>. A person decides once, and every price with that name, past and future, follows that decision.
          </p>
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle>Scraping and storing: one price, step by step</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <ol className="space-y-4">
              <Step n={1} title="Fetch">
                The scraper reads Agmarknet: Karnal mandi, Haryana, <i>Paddy(Common)</i>, 1 Nov, modal ₹2,320.
              </Step>
              <Step n={2} title="Clean">
                Dates, numbers and units are made uniform. Rows with no price at all, or dated in the future, are skipped.
              </Step>
              <Step n={3} title="Find or create the listing">
                The listing key is <Code>source + state + mandi name + crop name + variety</Code>. The same key always gives the same listing, so a day&apos;s re-run does not make duplicates.
              </Step>
              <Step n={4} title="Record new names as pending">
                If <i>Paddy(Common)</i> or <i>Karnal</i> was never seen for this source, it is added to Crop names or Mandi names as <b>pending</b>, with a suggestion from the old system.
              </Step>
              <Step n={5} title="Copy in approved links">
                If those names are approved, the listing gets <Code>product_id</Code> and <Code>mandi_id</Code>. If not, they stay empty and farmers see no price for it yet.
              </Step>
              <Step n={6} title="Save the price">
                One price per listing per day (key <Code>listing + date</Code>). Scraping the same day again updates it instead of adding a second one.
              </Step>
              <Step n={7} title="Log the run">
                The run is written to Scrape runs. Odd prices (zero, min above max…) and unknown names go to the Review list.
              </Step>
            </ol>
          </div>
          <div className="space-y-3">
            <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{COLL.listings}</div>
            <Json>{`{
  _id: "6a42…0b2b",
  source_system: "agmarknet",
  state: "haryana",       state_code: "haryana",
  market_name: "karnal",
  commodity_name: "paddy(common)",
  variety: "common",
  product_id: "…paddy",   // from the approved crop name
  mandi_id:   "…karnal"   // from the approved mandi name
}`}</Json>
            <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{COLL.prices}</div>
            <Json>{`{
  market_commodity_id: "6a42…0b2b",  // the listing above
  date: "2026-11-01",
  min_price: 2250, max_price: 2400, modal_price: 2320,
  arrival_quantity: 120,
  run_id: "eb71…",  ingested_at: "2026-11-01T08:18Z"
}`}</Json>
            <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{COLL.cropNames}</div>
            <Json>{`{
  source: "agmarknet",
  raw_name: "paddy(common)",  raw_variety: "*",   // * = every variety
  product_id: "…paddy",
  status: "approved",          // pending | approved | rejected
  decided_by: "expert",  decided_at: "2026-11-01"
}`}</Json>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle>How the records connect</SectionTitle>
        <div className="card p-5">
          <div className="mx-auto grid max-w-3xl gap-2 text-center md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
            <Box title="price record">a day&apos;s min / max / modal</Box>
            <Right />
            <Box title="listing" tone="blue">source&apos;s own names</Box>
            <Right />
            <div className="space-y-2">
              <Box title="product → crop" tone="emerald">via product_id</Box>
              <Box title="mandi (available_mandi)" tone="emerald">via mandi_id</Box>
            </div>
          </div>
          <p className="mt-4 text-sm text-zinc-600">
            A price only knows its listing. The listing knows its product and mandi only after the names are approved. When a reviewer approves or changes a link, every listing with that name is updated at once. Prices never need to change.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-600">
            <li><b>Variety links win over the &ldquo;*&rdquo; link.</b> &ldquo;paddy(basmati)&rdquo; with variety &ldquo;1121&rdquo; can point to basmati paddy while every other variety stays paddy.</li>
            <li><b>Rejected</b> means &ldquo;not something we show&rdquo;. Its listings lose their product, so their prices stay hidden.</li>
            <li><b>Back to pending</b> also hides the prices until someone decides again.</li>
          </ul>
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle>Every collection and its job</SectionTitle>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Collection</th><th>What it holds</th><th>Written by</th></tr>
            </thead>
            <tbody>
              {collections.map((c) => (
                <tr key={c.name}>
                  <td className="font-mono text-xs whitespace-nowrap">
                    {c.href ? <Link href={c.href} className="text-emerald-700 hover:underline">{c.name}</Link> : c.name}
                  </td>
                  <td className="text-sm">{c.job}</td>
                  <td className="text-xs text-zinc-500">{c.writer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle>How the farmer tool finds a price</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <div className="mb-3 text-sm text-zinc-600">Farmer asks: <b>&ldquo;dhan ka bhav Karnal mandi mein?&rdquo;</b> The planner translates it into English (&ldquo;paddy price in Karnal mandi&rdquo;), and the agent calls the tool with crop <Code>paddy</Code>, state Haryana, mandi Karnal.</div>
            <ol className="space-y-4">
              <Step n={1} title="Crop word → one product">
                Checked in this order; the first hit wins:
                <ol className="mt-1 list-[lower-alpha] space-y-0.5 pl-5">
                  <li>a product or crop name (a crop gives its default product)</li>
                  <li>an <b>approved</b> farmer word: dry chillies → red chilli. A pending or rejected word stops here with no price.</li>
                  <li>an approved source spelling from Crop names</li>
                  <li>a clear typo: one wrong letter (two for long names), and no other crop equally close</li>
                </ol>
                Case, word order and punctuation are ignored: &ldquo;Ginger (Dry)&rdquo; = &ldquo;dry ginger&rdquo;.
              </Step>
              <Step n={2} title="State → state code">From the States page spellings, so &ldquo;Orissa&rdquo; finds Odisha.</Step>
              <Step n={3} title="Listings">Only listings with that <Code>product_id</Code> in that state. Pending names have no product, so they are never used.</Step>
              <Step n={4} title="Mandi">By the mandi name asked for, or nearest to the farmer&apos;s location using available_mandi coordinates.</Step>
              <Step n={5} title="Prices">The asked day or range. If today has no price, the latest one is given with a note saying its date.</Step>
            </ol>
          </div>
          <div className="space-y-4">
            <div className="card p-5">
              <SectionTitle>What the farmer gets back</SectionTitle>
              <ul className="space-y-2 text-sm text-zinc-600">
                <li><b className="text-emerald-800">A price</b> for one product only: asking for paddy never mixes in rice or basmati.</li>
                <li><b className="text-amber-800">&ldquo;Did you mean…&rdquo;</b> when the word is unknown (<Code>crop_not_recognised</Code>).</li>
                <li><b className="text-amber-800">No mandi in this state</b> trades it (<Code>no_listings_in_state</Code>).</li>
                <li><b className="text-amber-800">Not available</b> while the name is still pending review, instead of a guessed price.</li>
              </ul>
            </div>
            <div className="card p-5">
              <SectionTitle>When your decisions show up</SectionTitle>
              <ul className="space-y-2 text-sm text-zinc-600">
                <li>Listings change <b>immediately</b> when you approve, change or reject a name.</li>
                <li>The tool reloads names and farmer words <b>every 5 minutes</b>.</li>
                <li>Every change is in the <Link href={`/data/${COLL.audit}`} className="text-emerald-700 hover:underline">change history</Link>.</li>
              </ul>
            </div>
            <div className="card p-5">
              <SectionTitle>v1 is untouched</SectionTitle>
              <p className="text-sm text-zinc-600">
                The old collections (<Code>markets_commodities</Code>, <Code>price_records</Code>, <Code>commodity_alias_lookup</Code>) and the old tool keep working as before. v2 lives next to them in <Code>v2_</Code> collections; only <Code>available_mandi</Code> is shared.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
