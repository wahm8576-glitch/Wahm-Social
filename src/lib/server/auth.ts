import "server-only";
import { roleFor } from "./roles";
/**
 * JWT session auth (HS256 via `jose`) stored in an httpOnly cookie.
 * Works in route handlers and server components.
 */
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { env } from "../env";
import { Users, type User } from "./db";
import { PlatformError } from "../platforms/types";
import { hasFeature, type Feature } from "../plans";

export const SESSION_COOKIE = "wahm_session";
const MAX_AGE = 60 * 60 * 24 * 30;
const key = () => new TextEncoder().encode(env.jwtSecret);

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: User["plan"];
  role: User["role"];
}

export { roleFor };
export const publicUser = (u: User): SessionUser => ({ id: u.id, email: u.email, name: u.name, plan: u.plan, role: u.role });

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .setIssuer("wahm-social")
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "wahm-social" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.isProd,
    path: "/",
    maxAge: MAX_AGE,
  };
}

function syncRole(u: User): User {
  const role = roleFor(u);
  return role === u.role ? u : Users.update(u.id, { role }) ?? { ...u, role };
}

/** Resolve the current user (server components & route handlers). */
export async function currentUser(): Promise<User | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const id = await verifySession(token);
  if (!id) return null;
  const u = Users.byId(id);
  if (!u) return null;
  if (u.plan !== "free" && u.planRenewsAt && u.planRenewsAt < Date.now()) {
    return Users.update(u.id, { plan: "free" }) ?? u;
  }
  return syncRole(u);
}

/** Resolve user from cookie OR `x-api-key` header (Business plan API access). */
export async function userFromRequest(req: Request): Promise<User | null> {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) {
    const u = Users.byApiKey(apiKey);
    if (u && hasFeature(u.plan, "api_access")) return syncRole(u);
  }
  return currentUser();
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new PlatformError("unauthorized", "Sign in required", 401);
  return u;
}

export async function requireFeature(f: Feature): Promise<User> {
  const u = await requireUser();
  if (!hasFeature(u.plan, f)) throw new PlatformError("pro_required", "This feature requires Frostly Pro", 402);
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "admin") throw new PlatformError("unauthorized", "Admins only", 403);
  return u;
}
