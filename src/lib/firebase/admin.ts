import "server-only";
/** Lazily initialised firebase-admin (re-initialised when the stored service account changes). */
import { createHash } from "node:crypto";
import type { App } from "firebase-admin/app";
import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { readServiceAccount } from "./config";

const g = globalThis as unknown as { __fbAdmin?: { key: string; app: App; auth: Auth } };

export async function adminAuth(): Promise<Auth> {
  const sa = readServiceAccount();
  if (!sa) throw new Error("Firebase service account is not configured");
  const key = createHash("sha256").update(`${sa.projectId}|${sa.clientEmail}|${sa.privateKey}`).digest("hex").slice(0, 16);
  if (g.__fbAdmin?.key === key) return g.__fbAdmin.auth;
  const { initializeApp, cert, getApps, deleteApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const name = `frostly-${key}`;
  const old = getApps().filter((a) => a.name.startsWith("frostly-") && a.name !== name);
  await Promise.all(old.map((a) => deleteApp(a).catch(() => {})));
  const app = getApps().find((a) => a.name === name) ?? initializeApp({ credential: cert({ projectId: sa.projectId, clientEmail: sa.clientEmail, privateKey: sa.privateKey }), projectId: sa.projectId }, name);
  const auth = getAuth(app);
  g.__fbAdmin = { key, app, auth };
  return auth;
}

export async function verifyFirebaseToken(idToken: string): Promise<DecodedIdToken> {
  return (await adminAuth()).verifyIdToken(idToken, true);
}

export async function firebaseUserByEmail(email: string): Promise<UserRecord | null> {
  try {
    return await (await adminAuth()).getUserByEmail(email);
  } catch (e) {
    if ((e as { code?: string })?.code === "auth/user-not-found") return null;
    throw e;
  }
}

export async function createFirebaseUser(p: { email: string; password?: string; displayName?: string }): Promise<UserRecord> {
  return (await adminAuth()).createUser({ email: p.email, password: p.password, displayName: p.displayName || undefined, emailVerified: false });
}
