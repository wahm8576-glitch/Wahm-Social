import "server-only";
/** Firestore backend for the document store (default database, server-only access via the service account). */
import type { Firestore } from "firebase-admin/firestore";
import { adminApp } from "../firebase/admin";
import { readServiceAccount } from "../firebase/config";
import type { RemoteBackend } from "./mirror";
export { FIRESTORE_SPEC } from "./firestoreSpec";

export const firestoreConfigured = () => !!readServiceAccount();

let fs: Firestore | null = null;
async function store(): Promise<Firestore> {
  if (fs) return fs;
  const { getFirestore } = await import("firebase-admin/firestore");
  const db = getFirestore(await adminApp());
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {}
  fs = db;
  return db;
}

const today = () => new Date().toISOString().slice(0, 10);

export const firestoreBackend: RemoteBackend = {
  async load() {
    const db = await store();
    const [users, watchlist, payments, billingEvents, usage, app] = await Promise.all([
      db.collection("users").get(),
      db.collection("watchlist").get(),
      db.collection("payments").get(),
      db.collection("billingEvents").get(),
      db.collection("usage").where("day", "==", today()).get(),
      db.collection("app").doc("searches").get(),
    ]);
    const rows = (q: FirebaseFirestore.QuerySnapshot) => q.docs.map((d) => d.data());
    return {
      users: rows(users),
      watchlist: rows(watchlist),
      payments: rows(payments),
      billingEvents: rows(billingEvents),
      usage: rows(usage).map(({ day: _d, ...rest }) => rest),
      searches: ((app.data()?.items as unknown[]) ?? []),
    };
  },
  async commit(ops) {
    const db = await store();
    const batch = db.batch();
    for (const op of ops) {
      const ref = db.collection(op.coll).doc(op.id);
      if (op.data) batch.set(ref, op.data);
      else batch.delete(ref);
    }
    await batch.commit();
  },
};

/** Persistent last-good copies (collection "profiles"): one small doc per profile key. */
export async function lastGoodRead(id: string): Promise<{ at: number; json: string } | null> {
  const db = await store();
  const d = await db.collection("profiles").doc(id).get();
  const v = d.data();
  return v && typeof v.json === "string" ? { at: Number(v.at) || 0, json: v.json } : null;
}

export async function lastGoodWrite(id: string, key: string, json: string) {
  const db = await store();
  await db.collection("profiles").doc(id).set({ key, at: Date.now(), json });
}
