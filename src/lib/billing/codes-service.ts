/**
 * Generate batches and redeem activation codes. Plaintext is kept only in a short-lived reveal cache.
 */
import { env } from "@/lib/env";
import {
  ActivationBatches,
  ActivationCodes,
  Users,
  db,
  newId,
  redeemCodeInMemory,
  type Payment,
  type User,
} from "@/lib/server/db";
import { firestoreConfigured } from "@/lib/server/firestoreStore";
import { logError } from "@/lib/server/errorLog";
import { endOfDayRiyadh, GrantError } from "@/lib/billing/admin-grant";
import {
  alreadyRedeemedBy,
  applyCodeToPlan,
  batchStats,
  codeLast4,
  generateActivationCode,
  GENERIC_REDEEM_ERROR,
  hashActivationCode,
  normalizeActivationCode,
  recordRedeemAttempt,
  redeemRateState,
  REDEEM_RATE_ERROR,
  resolveCodeDays,
  whyUnredeemable,
  type ActivationBatch,
  type ActivationCode,
  type CodeDurationKind,
  type PaidPlan,
} from "./codes";
import type { PlanId } from "@/lib/plans";

const g = globalThis as unknown as { __frostlyCodeReveal?: Map<string, Reveal> };
const reveals = () => (g.__frostlyCodeReveal ??= new Map<string, Reveal>());
const REVEAL_TTL_MS = 30 * 60_000;

export interface Reveal {
  id: string;
  at: number;
  batchId: string;
  label: string;
  plan: PaidPlan;
  days: number;
  expiresAt?: number;
  maxUses: number;
  codes: string[];
}

export function stashReveal(data: Omit<Reveal, "id" | "at">): Reveal {
  const id = newId("rv_");
  const row: Reveal = { ...data, id, at: Date.now() };
  const map = reveals();
  map.set(id, row);
  for (const [k, v] of map) if (Date.now() - v.at > REVEAL_TTL_MS) map.delete(k);
  return row;
}

export function peekReveal(id: string): Reveal | undefined {
  const row = reveals().get(id);
  if (!row) return undefined;
  if (Date.now() - row.at > REVEAL_TTL_MS) {
    reveals().delete(id);
    return undefined;
  }
  return row;
}

export function generateBatch(opts: {
  count: number;
  plan: PaidPlan;
  durationKind: CodeDurationKind;
  days?: number;
  label?: string;
  note?: string;
  expiresOn?: string;
  maxUses?: number;
  createdBy?: string;
  now?: number;
  secret?: string;
}): { batch: ActivationBatch; reveal: Reveal } {
  const count = Number(opts.count);
  if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error("عدد الأكواد لازم يكون بين 1 و 10000");
  if (opts.plan !== "pro" && opts.plan !== "business") throw new Error("خطة غير صالحة");
  const days = resolveCodeDays(opts.durationKind, opts.days);
  const maxUses = opts.maxUses == null || opts.maxUses === 0 ? 1 : Number(opts.maxUses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) throw new Error("عدد الاستخدامات لازم يكون بين 1 و 1000");
  let expiresAt: number | undefined;
  if (opts.expiresOn && opts.expiresOn.trim()) {
    expiresAt = endOfDayRiyadh(opts.expiresOn.trim());
    if (expiresAt <= (opts.now ?? Date.now())) throw new GrantError("تاريخ انتهاء صلاحية الكود لازم يكون في المستقبل");
  }
  const secret = opts.secret ?? env.jwtSecret;
  const batchId = newId("ab_");
  const label = (opts.label || "").trim().slice(0, 80);
  const now = opts.now ?? Date.now();
  const seen = new Set(ActivationCodes.all().map((c) => c.hash));
  const plain: string[] = [];
  const records: ActivationCode[] = [];
  let guard = 0;
  while (plain.length < count) {
    if (++guard > count * 5) throw new Error("تعذر توليد أكواد فريدة");
    const code = generateActivationCode();
    const hash = hashActivationCode(code, secret);
    if (seen.has(hash)) continue;
    seen.add(hash);
    plain.push(code);
    records.push({
      id: newId("ac_"),
      batchId,
      hash,
      last4: codeLast4(code),
      plan: opts.plan,
      days,
      maxUses,
      uses: 0,
      expiresAt,
      label,
      redemptions: [],
    });
  }
  const batch: ActivationBatch = {
    id: batchId,
    createdAt: now,
    createdBy: opts.createdBy,
    label,
    note: (opts.note || "").trim().slice(0, 300) || undefined,
    plan: opts.plan,
    durationKind: opts.durationKind,
    days,
    expiresAt,
    maxUses,
    total: count,
  };
  ActivationBatches.add(batch);
  ActivationCodes.addMany(records);
  const reveal = stashReveal({
    batchId,
    label,
    plan: opts.plan,
    days,
    expiresAt,
    maxUses,
    codes: plain,
  });
  return { batch, reveal };
}

export function listBatchViews(now = Date.now()) {
  return ActivationBatches.all().map((b) => ({
    batch: b,
    stats: batchStats(ActivationCodes.forBatch(b.id), Boolean(b.disabled), now),
  }));
}

export type RedeemOk = { ok: true; plan: PlanId; planRenewsAt: number; payment: Payment; extended: boolean };
export type RedeemFail = { ok: false; status: number; messageAr: string; messageEn: string; code: string };

function genericFail(): RedeemFail {
  return { ok: false, status: 400, messageAr: GENERIC_REDEEM_ERROR.ar, messageEn: GENERIC_REDEEM_ERROR.en, code: "invalid" };
}
function rateFail(): RedeemFail {
  return { ok: false, status: 429, messageAr: REDEEM_RATE_ERROR.ar, messageEn: REDEEM_RATE_ERROR.en, code: "rate_limited" };
}

export async function redeemForUser(opts: {
  rawCode: string;
  user: User;
  ip: string;
  locale?: "ar" | "en";
  now?: number;
}): Promise<RedeemOk | RedeemFail> {
  const now = opts.now ?? Date.now();
  const userKey = `redeem:u:${opts.user.id}`;
  const ipKey = `redeem:ip:${opts.ip || "0.0.0.0"}`;
  if (!redeemRateState(userKey, now).allowed || !redeemRateState(ipKey, now).allowed) {
    logError("codes", `redeem locked user=${opts.user.email} ip=${opts.ip}`);
    return rateFail();
  }

  const normalized = normalizeActivationCode(opts.rawCode);
  const last4 = normalized ? codeLast4(normalized) : "????";
  if (!normalized) {
    recordRedeemAttempt(userKey, now);
    recordRedeemAttempt(ipKey, now);
    logError("codes", `redeem invalid-format last4=${last4} user=${opts.user.email} ip=${opts.ip}`);
    return genericFail();
  }

  const hash = hashActivationCode(normalized, env.jwtSecret);
  let result: RedeemOk | RedeemFail;

  if (firestoreConfigured()) {
    try {
      const { redeemCodeInFirestore } = await import("@/lib/server/firestoreStore");
      const tx = await redeemCodeInFirestore({
        hash,
        user: { id: opts.user.id, email: opts.user.email, plan: opts.user.plan, planRenewsAt: opts.user.planRenewsAt },
        paymentId: newId("pay_"),
        now,
      });
      if (!tx.ok) {
        recordRedeemAttempt(userKey, now);
        recordRedeemAttempt(ipKey, now);
        logError("codes", `redeem ${tx.reason} last4=${last4} user=${opts.user.email} ip=${opts.ip}`);
        return genericFail();
      }
      // Keep the in-memory store in sync without a second increment: apply the transaction result.
      applyTxToMemory(tx.code, opts.user.id, tx.plan, tx.planRenewsAt, tx.payment);
      const extended = applyCodeToPlan({
        codePlan: tx.code.plan,
        days: tx.code.days,
        currentPlan: opts.user.plan,
        planRenewsAt: opts.user.planRenewsAt,
        now,
      }).extended;
      result = { ok: true, plan: tx.plan, planRenewsAt: tx.planRenewsAt, payment: tx.payment, extended };
    } catch (e) {
      logError("codes", `redeem tx error last4=${last4}: ${String((e as Error).message || e)}`);
      // If the code is already in memory (e.g. Firestore briefly unavailable after a local generate), try once locally.
      result = redeemMemory(hash, opts.user, userKey, ipKey, last4, now, opts.ip);
    }
  } else {
    result = redeemMemory(hash, opts.user, userKey, ipKey, last4, now, opts.ip);
  }

  if (result.ok) {
    logError("codes", `redeem ok last4=${last4} user=${opts.user.email} plan=${result.plan}`);
  }
  return result;
}

function redeemMemory(
  hash: string,
  user: User,
  userKey: string,
  ipKey: string,
  last4: string,
  now: number,
  ip: string,
): RedeemOk | RedeemFail {
  const mem = redeemCodeInMemory({ hash, user, now });
  if (!mem.ok) {
    recordRedeemAttempt(userKey, now);
    recordRedeemAttempt(ipKey, now);
    logError("codes", `redeem ${mem.reason} last4=${last4} user=${user.email} ip=${ip}`);
    return genericFail();
  }
  const extended = applyCodeToPlan({
    codePlan: mem.code.plan,
    days: mem.code.days,
    currentPlan: user.plan,
    planRenewsAt: user.planRenewsAt,
    now,
  }).extended;
  return { ok: true, plan: mem.plan, planRenewsAt: mem.planRenewsAt, payment: mem.payment, extended };
}

function applyTxToMemory(code: ActivationCode, userId: string, plan: PlanId, planRenewsAt: number, payment: Payment) {
  const existing = ActivationCodes.byHash(code.hash);
  if (existing && alreadyRedeemedBy(existing, userId)) return;
  db.mutate((d) => {
    const c = d.activationCodes.find((x) => x.hash === code.hash);
    if (c) {
      c.uses = code.uses;
      c.redemptions = code.redemptions;
    } else {
      d.activationCodes.push(code);
    }
    const u = d.users.find((x) => x.id === userId);
    if (u) {
      u.plan = plan;
      u.planRenewsAt = planRenewsAt;
    }
    if (!d.payments.some((p) => p.id === payment.id)) d.payments.push(payment);
  });
}

export function disableOneCode(id: string) {
  const c = ActivationCodes.byId(id);
  if (!c) throw new Error("الكود غير موجود");
  ActivationCodes.update(c.hash, { disabled: true });
}

export function disableWholeBatch(batchId: string) {
  if (!ActivationBatches.byId(batchId)) throw new Error("الدفعة غير موجودة");
  ActivationCodes.disableBatch(batchId);
}

export function searchCodes(q: string) {
  const s = q.trim();
  if (!s) return [] as ActivationCode[];
  if (s.includes("@")) return ActivationCodes.byEmail(s);
  if (s.length <= 4) return ActivationCodes.byLast4(s);
  const n = normalizeActivationCode(s);
  if (n) {
    const hit = ActivationCodes.byHash(hashActivationCode(n, env.jwtSecret));
    return hit ? [hit] : [];
  }
  return ActivationCodes.byLast4(s.slice(-4));
}

export { whyUnredeemable };
