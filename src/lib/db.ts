import "server-only";
import { MongoClient, type Db } from "mongodb";

/** Collection names in the v2 database. Override with env vars if yours differ. */
export const COLL = {
  listings: process.env.LISTINGS_COLLECTION || "listings",
  prices: process.env.PRICE_COLLECTION || "price_records",
  mandis: process.env.ALL_MANDI_COLLECTION || "available_mandi",
  crops: process.env.CROPS_COLLECTION || "crops",
  products: process.env.PRODUCTS_COLLECTION || "products",
  cropNames: process.env.CROP_NAMES_COLLECTION || "crop_names",
  mandiNames: process.env.MANDI_NAMES_COLLECTION || "mandi_names",
  states: process.env.STATES_COLLECTION || "states",
  runs: process.env.INGESTION_RUNS_COLLECTION || "ingestion_runs",
  review: process.env.REVIEW_ITEMS_COLLECTION || "review_items",
  audit: process.env.AUDIT_COLLECTION || "audit_log",
} as const;

/** Upper bound for any single query, so a slow page never hangs a serverless function. */
export const MAX_TIME_MS = 20_000;

const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

function clientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  // Reuse one client across hot reloads and warm serverless invocations.
  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(uri, { maxPoolSize: 10 }).connect();
  }
  return globalForMongo._mongoClient;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise();
  return client.db(process.env.MONGODB_DB || "PriceV2");
}
