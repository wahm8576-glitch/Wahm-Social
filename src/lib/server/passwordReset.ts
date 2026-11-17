import "server-only";
/**
 * Stateless password-reset tokens (signed JWT, 30 minutes).
 * The token embeds a fingerprint of the user's current password hash, so it stops working
 * as soon as the password changes (single use) — no token table needed.
 */
import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";
import type { User } from "./db";

const TTL_MIN = 30;
const key = () => new TextEncoder().encode(`${env.jwtSecret}:password-reset`);
const fp = (hash: string) => createHash("sha256").update(hash).digest("base64url").slice(0, 16);

export const RESET_TTL_MIN = TTL_MIN;

export function signResetToken(user: User): Promise<string> {
  return new SignJWT({ sub: user.id, pwv: fp(user.passwordHash), typ: "pwreset" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_MIN}m`)
    .setIssuer("frostly")
    .sign(key());
}

/** Returns the user id when the token is valid for this user's current password. */
export async function verifyResetToken(token: string, lookup: (id: string) => User | undefined): Promise<User | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "frostly" });
    if (payload.typ !== "pwreset" || typeof payload.sub !== "string") return null;
    const u = lookup(payload.sub);
    if (!u || payload.pwv !== fp(u.passwordHash)) return null;
    return u;
  } catch {
    return null;
  }
}
