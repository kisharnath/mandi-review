import "server-only";
import { MongoClient, type Db } from "mongodb";

/**
 * Collection names. V2_COLLECTION_PREFIX (e.g. "v2_") lets v2 live next to v1 in the
 * same database; available_mandi is shared and never prefixed. Each name can also be
 * overridden on its own.
 */
const P = (process.env.V2_COLLECTION_PREFIX || "").trim();
export const COLL = {
  listings: process.env.LISTINGS_COLLECTION || `${P}listings`,
  prices: process.env.PRICE_COLLECTION || `${P}price_records`,
  mandis: process.env.ALL_MANDI_COLLECTION || "available_mandi",
  crops: process.env.CROPS_COLLECTION || `${P}crops`,
  products: process.env.PRODUCTS_COLLECTION || `${P}products`,
  cropNames: process.env.CROP_NAMES_COLLECTION || `${P}crop_names`,
  mandiNames: process.env.MANDI_NAMES_COLLECTION || `${P}mandi_names`,
  states: process.env.STATES_COLLECTION || `${P}states`,
  runs: process.env.INGESTION_RUNS_COLLECTION || `${P}ingestion_runs`,
  review: process.env.REVIEW_ITEMS_COLLECTION || `${P}review_items`,
  audit: process.env.AUDIT_COLLECTION || `${P}audit_log`,
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
