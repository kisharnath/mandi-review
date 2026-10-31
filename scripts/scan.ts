/**
 * One-time check of the crop matching already in the database.
 * Adds items to review_items; changes nothing else.
 *
 *   npm run scan
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import { scanMapping } from "../src/lib/scan";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI (e.g. in .env.local or .env)");
  const client = await new MongoClient(uri).connect();
  try {
    const db = client.db(process.env.MONGODB_DB || "Price");
    const res = await scanMapping(db, "scan-script");
    console.log(`Done: ${res.unmapped} unmatched names, ${res.suspicious} matches that look wrong, ${res.duplicates} names in more than one group.`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
