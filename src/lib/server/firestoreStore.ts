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
    const [users, watchlist, payments, billingEvents, usage, app, activationBatches, activationCodes] = await Promise.all([
      db.collection("users").get(),
      db.collection("watchlist").get(),
      db.collection("payments").get(),
      db.collection("billingEvents").get(),
      db.collection("usage").where("day", "==", today()).get(),
      db.collection("app").doc("searches").get(),
      db.collection("activationBatches").get(),
      db.collection("activationCodes").get(),
    ]);
    const rows = (q: FirebaseFirestore.QuerySnapshot) => q.docs.map((d) => d.data());
    return {
      users: rows(users),
      watchlist: rows(watchlist),
      payments: rows(payments),
      billingEvents: rows(billingEvents),
      usage: rows(usage).map(({ day: _d, ...rest }) => rest),
      searches: ((app.data()?.items as unknown[]) ?? []),
      activationBatches: rows(activationBatches),
      activationCodes: rows(activationCodes),
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

import { alreadyRedeemedBy, applyCodeToPlan, paymentIntervalForDays, whyUnredeemable, type ActivationBatch, type ActivationCode } from "../billing/codes";
import { normEmail, safeDocId } from "./mirror";
import type { PlanId } from "../plans";
import type { Payment } from "./db";

export type RedeemTxResult =
  | { ok: true; code: ActivationCode; plan: PlanId; planRenewsAt: number; payment: Payment }
  | { ok: false; reason: "invalid" | "used" | "expired" | "disabled" | "already" };

/** Atomic redeem against Firestore so two instances cannot use the same code twice. */
export async function redeemCodeInFirestore(opts: {
  hash: string;
  user: { id: string; email: string; plan: PlanId; planRenewsAt?: number };
  paymentId: string;
  now?: number;
}): Promise<RedeemTxResult> {
  const db = await store();
  const now = opts.now ?? Date.now();
  return db.runTransaction(async (tx) => {
    const codeRef = db.collection("activationCodes").doc(safeDocId(opts.hash));
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists) return { ok: false as const, reason: "invalid" as const };
    const code = codeSnap.data() as ActivationCode;
    if (!Array.isArray(code.redemptions)) code.redemptions = [];
    const batchRef = db.collection("activationBatches").doc(safeDocId(code.batchId));
    const batchSnap = await tx.get(batchRef);
    const batch: ActivationBatch = batchSnap.exists
      ? (batchSnap.data() as ActivationBatch)
      : {
          id: code.batchId,
          createdAt: 0,
          label: code.label || "",
          plan: code.plan,
          durationKind: "days",
          days: code.days,
          maxUses: code.maxUses,
          total: 1,
          disabled: false,
          expiresAt: code.expiresAt,
        };
    const why = whyUnredeemable(code, batch, now);
    if (why) return { ok: false as const, reason: why };
    if (alreadyRedeemedBy(code, opts.user.id)) return { ok: false as const, reason: "already" as const };
    const next = applyCodeToPlan({
      codePlan: code.plan,
      days: code.days,
      currentPlan: opts.user.plan,
      planRenewsAt: opts.user.planRenewsAt,
      now,
    });
    const redemption = { userId: opts.user.id, email: opts.user.email.toLowerCase(), at: now };
    const updated: ActivationCode = { ...code, uses: code.uses + 1, redemptions: [...code.redemptions, redemption] };
    const payment: Payment = {
      id: opts.paymentId,
      userId: opts.user.id,
      plan: code.plan,
      interval: paymentIntervalForDays(code.days),
      amount: 0,
      currency: "USD",
      provider: "code",
      status: "paid",
      createdAt: now,
      providerRef: code.id,
      batchLabel: code.label || batch.label || undefined,
    };
    const userRef = db.collection("users").doc(safeDocId(normEmail(opts.user.email)));
    tx.set(codeRef, JSON.parse(JSON.stringify(updated)) as Record<string, unknown>);
    tx.set(userRef, { plan: next.plan, planRenewsAt: next.planRenewsAt }, { merge: true });
    tx.set(db.collection("payments").doc(safeDocId(payment.id)), JSON.parse(JSON.stringify(payment)) as Record<string, unknown>);
    return { ok: true as const, code: updated, plan: next.plan, planRenewsAt: next.planRenewsAt, payment };
  });
}
