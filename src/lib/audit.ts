import "server-only";
import type { Db } from "mongodb";
import { COLL } from "./db";
import type { SessionUser } from "./session";

export type AuditEntry = {
  action: string;
  summary: string;
  target?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  counts?: Record<string, number>;
};

/** Every change made through the website is written here: who, what, when, before and after. */
export async function writeAudit(db: Db, user: SessionUser, entry: AuditEntry): Promise<void> {
  await db.collection(COLL.audit).insertOne({ ...entry, user: user.name, role: user.role, at: new Date() });
}
