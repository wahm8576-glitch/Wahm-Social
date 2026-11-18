import "server-only";
/**
 * Extra copy of the session pools in Firestore (encrypted with the same AES-GCM key as secrets.enc.json)
 * so they survive a Render disk wipe even if the admin data repo is briefly unreachable.
 * Health (no secrets) is stored alongside for admin status after a restart.
 */
import { seal, unseal, type Sealed } from "../admin/crypto";
import { firestoreConfigured } from "../server/firestoreStore";
import { loadHealth, snapshotHealth, type SessionKind } from "./runtime";
import { poolSecretKey, type PoolKind } from "./types";

const POOL_DOC = "session_pools";
const HEALTH_DOC = "session_pool_health";

async function fs() {
  if (!firestoreConfigured()) return null;
  const { getFirestore } = await import("firebase-admin/firestore");
  const { adminApp } = await import("../firebase/admin");
  return getFirestore(await adminApp());
}

export async function persistPoolsToFirestore(secrets: Record<string, string>) {
  const db = await fs();
  if (!db) return;
  const payload: Partial<Record<PoolKind, string>> = {};
  for (const kind of ["instagram", "tiktok"] as const) {
    const raw = secrets[poolSecretKey(kind)];
    if (raw) payload[kind] = raw;
  }
  if (!Object.keys(payload).length) return;
  try {
    await db.collection("app").doc(POOL_DOC).set({ enc: seal(JSON.stringify(payload)), at: Date.now() });
  } catch (e) {
    console.warn(`[pool] firestore save failed: ${String((e as Error).message ?? e).slice(0, 80)}`);
  }
}

export async function hydratePoolsFromFirestore(secrets: Record<string, string>): Promise<boolean> {
  const db = await fs();
  if (!db) return false;
  try {
    const d = await db.collection("app").doc(POOL_DOC).get();
    const enc = d.data()?.enc as Sealed | undefined;
    if (!enc?.data) return false;
    const parsed = JSON.parse(unseal(enc)) as Partial<Record<PoolKind, string>>;
    let changed = false;
    for (const kind of ["instagram", "tiktok"] as const) {
      const key = poolSecretKey(kind);
      if (!secrets[key] && parsed[kind]) {
        secrets[key] = parsed[kind]!;
        changed = true;
      }
    }
    return changed;
  } catch (e) {
    console.warn(`[pool] firestore load failed: ${String((e as Error).message ?? e).slice(0, 80)}`);
    return false;
  }
}

export async function persistHealthToFirestore() {
  const db = await fs();
  if (!db) return;
  try {
    const instagram = snapshotHealth("instagram");
    const tiktok = snapshotHealth("tiktok");
    await db.collection("app").doc(HEALTH_DOC).set({ instagram, tiktok, at: Date.now() });
  } catch {
    /* non-fatal */
  }
}

export async function hydrateHealthFromFirestore() {
  const db = await fs();
  if (!db) return;
  try {
    const d = await db.collection("app").doc(HEALTH_DOC).get();
    const v = d.data() ?? {};
    for (const kind of ["instagram", "tiktok"] as SessionKind[]) {
      if (v[kind] && typeof v[kind] === "object") loadHealth(kind, v[kind] as never);
    }
  } catch {
    /* non-fatal */
  }
}
