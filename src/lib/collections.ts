import { COLL } from "./db";

export type Column = {
  key: string; // dotted path into the document
  label: string;
  kind?: "text" | "number" | "date" | "datetime" | "id" | "bool" | "list" | "json" | "group" | "mandi";
};

export type FilterDef = { key: string; label: string; type: "select" | "date" | "nullable" };

export type CollectionDef = {
  name: string;
  label: string;
  description: string;
  searchFields: string[]; // case-insensitive "contains" search
  filters: FilterDef[];
  columns: Column[];
  sort: Record<string, 1 | -1>;
  /** price_records has no names of its own: search goes through markets_commodities. */
  searchVia?: "markets";
};

export const COLLECTIONS: CollectionDef[] = [
  {
    name: COLL.markets,
    label: "Mandi crop listings",
    description: "One row for each crop name at each mandi and source. Links a crop name to its crop group and mandi.",
    searchFields: ["commodity_name", "market_name", "variety"],
    filters: [
      { key: "state", label: "State", type: "select" },
      { key: "source_system", label: "Source", type: "select" },
      { key: "commodity_alias_lookup_id", label: "Crop group", type: "nullable" },
      { key: "market_id", label: "Mandi", type: "nullable" },
    ],
    columns: [
      { key: "commodity_name", label: "Crop name" },
      { key: "variety", label: "Variety" },
      { key: "grade", label: "Grade" },
      { key: "market_name", label: "Mandi" },
      { key: "state", label: "State" },
      { key: "source_system", label: "Source" },
      { key: "commodity_alias_lookup_id", label: "Crop group", kind: "group" },
      { key: "market_id", label: "Mandi record", kind: "mandi" },
    ],
    sort: { state: 1, market_name: 1, commodity_name: 1 },
  },
  {
    name: COLL.prices,
    label: "Daily prices",
    description: "Every price the scraper saved. Search finds prices by crop or mandi name.",
    searchFields: [],
    searchVia: "markets",
    filters: [
      { key: "date", label: "Date", type: "date" },
      { key: "commodity_alias_lookup_id", label: "Crop group", type: "nullable" },
    ],
    columns: [
      { key: "date", label: "Date", kind: "date" },
      { key: "_mc.commodity_name", label: "Crop name" },
      { key: "_mc.variety", label: "Variety" },
      { key: "_mc.market_name", label: "Mandi" },
      { key: "_mc.state", label: "State" },
      { key: "modal_price", label: "Modal ₹", kind: "number" },
      { key: "min_price", label: "Min ₹", kind: "number" },
      { key: "max_price", label: "Max ₹", kind: "number" },
      { key: "arrival_quantity", label: "Arrival", kind: "number" },
      { key: "ingested_at", label: "Saved at", kind: "datetime" },
    ],
    sort: { date: -1 },
  },
  {
    name: COLL.mandis,
    label: "Mandis",
    description: "Every mandi with its district and location.",
    searchFields: ["name", "aliases", "district", "postcode"],
    filters: [
      { key: "state", label: "State", type: "select" },
      { key: "district", label: "District", type: "select" },
      { key: "location", label: "Location", type: "nullable" },
    ],
    columns: [
      { key: "name", label: "Mandi" },
      { key: "state", label: "State" },
      { key: "district", label: "District" },
      { key: "postcode", label: "Postcode" },
      { key: "aliases", label: "Other names", kind: "list" },
      { key: "location.coordinates", label: "Lon, Lat", kind: "list" },
      { key: "source", label: "Added by" },
      { key: "updatedAt", label: "Updated", kind: "datetime" },
    ],
    sort: { state: 1, name: 1 },
  },
  {
    name: COLL.groups,
    label: "Crop groups",
    description: "Each crop group and the names that belong to it. The scraper matches names to these exactly.",
    searchFields: ["canonical_name", "aliases"],
    filters: [{ key: "active", label: "Active", type: "select" }],
    columns: [
      { key: "canonical_name", label: "Crop group" },
      { key: "aliases", label: "Names", kind: "list" },
      { key: "active", label: "Active", kind: "bool" },
      { key: "crop_master_id", label: "Crop master id", kind: "id" },
      { key: "updatedAt", label: "Updated", kind: "datetime" },
    ],
    sort: { canonical_name: 1 },
  },
  {
    name: COLL.runs,
    label: "Scrape runs",
    description: "One row per source per scraper run.",
    searchFields: ["source", "error"],
    filters: [
      { key: "source", label: "Source", type: "select" },
      { key: "success", label: "Worked", type: "select" },
    ],
    columns: [
      { key: "started_at", label: "Started", kind: "datetime" },
      { key: "source", label: "Source" },
      { key: "success", label: "Worked", kind: "bool" },
      { key: "records_fetched", label: "Fetched", kind: "number" },
      { key: "records_normalised", label: "Saved", kind: "number" },
      { key: "error", label: "Error" },
    ],
    sort: { started_at: -1 },
  },
  {
    name: COLL.review,
    label: "Review list",
    description: "Problems waiting for a person.",
    searchFields: ["title", "key"],
    filters: [
      { key: "type", label: "Type", type: "select" },
      { key: "status", label: "Status", type: "select" },
      { key: "state", label: "State", type: "select" },
    ],
    columns: [
      { key: "title", label: "Problem" },
      { key: "type", label: "Type" },
      { key: "status", label: "Status" },
      { key: "state", label: "State" },
      { key: "records_seen", label: "Records", kind: "number" },
      { key: "last_seen", label: "Last seen", kind: "datetime" },
      { key: "resolved_by", label: "Resolved by" },
    ],
    sort: { last_seen: -1 },
  },
  {
    name: COLL.audit,
    label: "Change history",
    description: "Every change made through this website.",
    searchFields: ["summary", "user", "action"],
    filters: [
      { key: "user", label: "User", type: "select" },
      { key: "action", label: "Action", type: "select" },
    ],
    columns: [
      { key: "at", label: "When", kind: "datetime" },
      { key: "user", label: "Who" },
      { key: "summary", label: "What" },
      { key: "counts", label: "Rows changed", kind: "json" },
    ],
    sort: { at: -1 },
  },
];

export function collectionDef(name: string): CollectionDef | undefined {
  return COLLECTIONS.find((c) => c.name === name);
}

/** For collections the site does not know about: show every top-level field. */
export function genericDef(name: string, sample: Record<string, unknown>[]): CollectionDef {
  const keys = [...new Set(sample.flatMap((d) => Object.keys(d)))].filter((k) => k !== "_id").slice(0, 10);
  const stringKeys = keys.filter((k) => sample.some((d) => typeof d[k] === "string"));
  return {
    name,
    label: name,
    description: "Collection without a custom view. Showing its first fields.",
    searchFields: stringKeys,
    filters: [],
    columns: keys.map((k) => ({ key: k, label: k })),
    sort: { _id: -1 },
  };
}
