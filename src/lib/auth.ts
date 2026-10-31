import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type Role, type SessionUser } from "./session";

/**
 * Users come from the APP_USERS env var:
 *   APP_USERS="kishar:long-password:admin,expert:another-password:reviewer,guest:pw:viewer"
 * admin and reviewer can change data; viewer can only look.
 */
type UserRecord = SessionUser & { password: string };

function users(): UserRecord[] {
  return (process.env.APP_USERS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, password, role = "reviewer"] = entry.split(":");
      return { name: name?.trim(), password: password ?? "", role: role.trim() as Role };
    })
    .filter((u) => u.name && u.password && ["admin", "reviewer", "viewer"].includes(u.role));
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkLogin(name: string, password: string): SessionUser | null {
  const found = users().find((u) => u.name.toLowerCase() === name.trim().toLowerCase());
  if (!found || !sameText(found.password, password)) return null;
  return { name: found.name, role: found.role };
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions that change data. */
export async function requireEditor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === "viewer") throw new Error("Your account can view data but not change it.");
  return user;
}

export function canEdit(user: SessionUser | null): boolean {
  return !!user && user.role !== "viewer";
}
