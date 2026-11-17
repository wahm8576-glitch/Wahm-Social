import "server-only";
import { randomBytes } from "node:crypto";
import { Users, type User } from "../server/db";
import { hashPassword } from "../server/auth";
import { env } from "../env";

/** Map a verified Firebase identity onto the site's user record (by email), creating it on first login. */
export async function userForFirebase(email: string, name?: string): Promise<User> {
  const e = email.toLowerCase();
  const existing = Users.byEmail(e);
  if (existing) return Users.update(existing.id, { lastLoginAt: Date.now() }) ?? existing;
  return Users.create({
    email: e,
    name: (name || e.split("@")[0]).slice(0, 60),
    // Firebase owns the password; the local hash is random and never usable.
    passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
    plan: "free",
    role: env.adminEmails.includes(e) || Users.all().length === 0 ? "admin" : "user",
    lastLoginAt: Date.now(),
  });
}
