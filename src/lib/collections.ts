import { COLL } from "./db";

export type Column = {
  key: string; // dotted path into the document
  label: string;
  kind?: "text" | "number" | "date" | "datetime" | "id" | "bool" | "list" | "json" | "product" | "mandi" | "status";
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
  /** price_records has no names of its own: search goes through listings. */
  searchVia?: "listings";
};

export const COLLECTIONS: CollectionDef[] = [
  {
    name: COLL.listings,
    label: "Listings",
    description: "One row per crop name at one mandi from one source. Product and mandi come only from approved name links.",
    searchFields: ["commodity_name", "market_name", "variety"],
    filters: [
      { key: "state_code", label: "State", type: "select" },
      { key: "source_system", label: "Source", type: "select" },
      { key: "product_id", label: "Product", type: "nullable" },
      { key: "mandi_id", label: "Mandi", type: "nullable" },
    ],
    columns: [
      { key: "commodity_name", label: "Crop name" },
      { key: "variety", label: "Variety" },
      { key: "market_name", label: "Mandi name" },
      { key: "state", label: "State" },
      { key: "source_system", label: "Source" },
      { key: "product_id", label: "Product", kind: "product" },
      { key: "mandi_id", label: "Mandi", kind: "mandi" },
      { key: "last_seen", label: "Last seen", kind: "datetime" },
    ],
    sort: { state: 1, market_name: 1, commodity_name: 1 },
  },
  {
    name: COLL.prices,
    label: "Daily prices",
    description: "Every price saved. A price points only at its listing. Search by crop or mandi name.",
    searchFields: [],
    searchVia: "listings",
    filters: [{ key: "date", label: "Date", type: "date" }],
    columns: [
      { key: "date", label: "Date", kind: "date" },
      { key: "_mc.commodity_name", label: "Crop name" },
      { key: "_mc.variety", label: "Variety" },
      { key: "_mc.market_name", label: "Mandi" },
      { key: "_mc.state", label: "State" },
      { key: "_mc.product_id", label: "Product", kind: "product" },
      { key: "modal_price", label: "Modal ₹", kind: "number" },
      { key: "min_price", label: "Min ₹", kind: "number" },
      { key: "max_price", label: "Max ₹", kind: "number" },
      { key: "arrival_quantity", label: "Arrival", kind: "number" },
      { key: "ingested_at", label: "Saved at", kind: "datetime" },
    ],
    sort: { date: -1 },
  },
  {
    name: COLL.deletedPrices,
    label: "Deleted prices",
    description: "Copies of prices deleted on the Wrong prices page, with who deleted them and why. Copy one back to price_records to undo.",
    searchFields: ["deleted_by", "delete_reason"],
    filters: [
      { key: "deleted_by", label: "Deleted by", type: "select" },
      { key: "date", label: "Date", type: "date" },
    ],
    columns: [
      { key: "date", label: "Price date", kind: "date" },
      { key: "min_price", label: "Min ₹", kind: "number" },
      { key: "max_price", label: "Max ₹", kind: "number" },
      { key: "modal_price", label: "Modal ₹", kind: "number" },
      { key: "problems", label: "Problems", kind: "list" },
      { key: "deleted_by", label: "Deleted by" },
      { key: "deleted_at", label: "Deleted", kind: "datetime" },
      { key: "delete_reason", label: "Reason" },
    ],
    sort: { deleted_at: -1 },
  },
  {
    name: COLL.cropNames,
    label: "Crop name links",
    description: "Each crop name a source uses, and the product a person approved for it.",
    searchFields: ["raw_name", "raw_variety", "notes"],
    filters: [
      { key: "status", label: "Status", type: "select" },
      { key: "source", label: "Source", type: "select" },
      { key: "decided_by", label: "Decided by", type: "select" },
    ],
    columns: [
      { key: "raw_name", label: "Crop name" },
      { key: "raw_variety", label: "Variety" },
      { key: "source", label: "Source" },
      { key: "status", label: "Status", kind: "status" },
      { key: "product_id", label: "Product", kind: "product" },
      { key: "listings", label: "Listings", kind: "number" },
      { key: "decided_by", label: "Decided by" },
      { key: "decided_at", label: "Decided", kind: "datetime" },
    ],
    sort: { listings: -1 },
  },
  {
    name: COLL.mandiNames,
    label: "Mandi name links",
    description: "Each mandi name a source uses in a state, and the mandi a person approved for it.",
    searchFields: ["raw_name", "notes"],
    filters: [
      { key: "status", label: "Status", type: "select" },
      { key: "state_code", label: "State", type: "select" },
      { key: "source", label: "Source", type: "select" },
    ],
    columns: [
      { key: "raw_name", label: "Mandi name" },
      { key: "state_code", label: "State" },
      { key: "source", label: "Source" },
      { key: "status", label: "Status", kind: "status" },
      { key: "mandi_id", label: "Mandi", kind: "mandi" },
      { key: "listings", label: "Listings", kind: "number" },
      { key: "decided_by", label: "Decided by" },
    ],
    sort: { listings: -1 },
  },
  {
    name: COLL.cropWords,
    label: "Farmer words",
    description: "Words farmers use for a crop, and the crop or product a person approved for them.",
    searchFields: ["word", "key", "notes"],
    filters: [
      { key: "status", label: "Status", type: "select" },
      { key: "languages", label: "Language", type: "select" },
      { key: "decided_by", label: "Decided by", type: "select" },
    ],
    columns: [
      { key: "word", label: "Word" },
      { key: "status", label: "Status", kind: "status" },
      { key: "product_id", label: "Product", kind: "product" },
      { key: "crop_id", label: "Crop id", kind: "id" },
      { key: "languages", label: "Languages", kind: "list" },
      { key: "sources", label: "From", kind: "list" },
      { key: "decided_by", label: "Decided by" },
    ],
    sort: { word: 1 },
  },
  {
    name: COLL.crops,
    label: "Crops",
    description: "Crops, each with a default product used when a farmer names only the crop.",
    searchFields: ["name", "notes"],
    filters: [{ key: "active", label: "Active", type: "select" }],
    columns: [
      { key: "name", label: "Crop" },
      { key: "default_product_id", label: "Default product", kind: "product" },
      { key: "active", label: "Active", kind: "bool" },
      { key: "crop_master_id", label: "Crop master id", kind: "id" },
    ],
    sort: { name: 1 },
  },
  {
    name: COLL.products,
    label: "Products",
    description: "Products of each crop (for example ordinary paddy, basmati paddy, rice).",
    searchFields: ["name"],
    filters: [
      { key: "form", label: "Form", type: "select" },
      { key: "active", label: "Active", type: "select" },
    ],
    columns: [
      { key: "name", label: "Product" },
      { key: "crop_id", label: "Crop id", kind: "id" },
      { key: "form", label: "Form" },
      { key: "price_unit", label: "Unit" },
      { key: "active", label: "Active", kind: "bool" },
    ],
    sort: { name: 1 },
  },
  {
    name: COLL.mandis,
    label: "Mandis",
    description: "Every mandi with its district and location (schema unchanged from v1).",
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
      { key: "updatedAt", label: "Updated", kind: "datetime" },
    ],
    sort: { state: 1, name: 1 },
  },
  {
    name: COLL.states,
    label: "States",
    description: "Each state with every spelling the sources use.",
    searchFields: ["name", "spellings"],
    filters: [],
    columns: [
      { key: "_id", label: "Code" },
      { key: "name", label: "State" },
      { key: "spellings", label: "Spellings", kind: "list" },
    ],
    sort: { name: 1 },
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
    label: "Problems",
    description: "Failed scrapes, unknown state spellings and odd prices.",
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
