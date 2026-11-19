/**
 * Subscription activation (gift/voucher) codes.
 * Plaintext is never stored: only HMAC-SHA256(server secret, canonical code) and last 4 chars.
 */
import crypto from "node:crypto";
import type { PlanId } from "@/lib/plans";

/** Crockford base32 (no I, L, O, U) — unambiguous in print and speech. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_SET = new Set(CROCKFORD.split(""));
const AMBIGUOUS: Record<string, string> = { I: "1", L: "1", O: "0", U: "V" };

export const CODE_PREFIX = "FROST";
export const CODE_BODY_LEN = 16;
export const CODE_ENTROPY_BITS = 80;
export const REDEEM_WINDOW_MS = 10 * 60_000;
export const REDEEM_MAX_ATTEMPTS = 5;
export const REDEEM_LOCK_MS = 60 * 60_000;
const DAY = 86_400_000;

export type PaidPlan = "pro" | "business";
export type CodeDurationKind = "month" | "year" | "days";

export interface ActivationRedemption {
  userId: string;
  email: string;
  at: number;
}

export interface ActivationCode {
  id: string;
  batchId: string;
  hash: string;
  last4: string;
  plan: PaidPlan;
  days: number;
  maxUses: number;
  uses: number;
  expiresAt?: number;
  disabled?: boolean;
  label?: string;
  redemptions: ActivationRedemption[];
}

export interface ActivationBatch {
  id: string;
  createdAt: number;
  createdBy?: string;
  label: string;
  note?: string;
  plan: PaidPlan;
  durationKind: CodeDurationKind;
  days: number;
  expiresAt?: number;
  maxUses: number;
  total: number;
  disabled?: boolean;
}

export function encodeCrockfordBits(bytes: Uint8Array, bitCount: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  const needed = Math.ceil(bitCount / 5);
  for (let i = 0; i < bytes.length && out.length < needed; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5 && out.length < needed) {
      bits -= 5;
      out += CROCKFORD[(value >>> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }
  if (out.length < needed && bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/** FROST-XXXX-XXXX-XXXX-XXXX from 80 bits of CSPRNG. */
export function generateActivationCode(randomBytes: (n: number) => Uint8Array = (n) => crypto.randomBytes(n)): string {
  const body = encodeCrockfordBits(randomBytes(10), CODE_ENTROPY_BITS);
  if (body.length !== CODE_BODY_LEN) throw new Error("failed to encode activation code");
  return formatCodeBody(body);
}

export function formatCodeBody(body: string): string {
  const b = body.toUpperCase();
  return `${CODE_PREFIX}-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}`;
}

/** Canonical dashed form, or null if the input cannot be a Frostly code. */
export function normalizeActivationCode(raw: string): string | null {
  const compact = String(raw || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  if (!compact.startsWith(CODE_PREFIX)) return null;
  const body = compact.slice(CODE_PREFIX.length).replace(/[ILOU]/g, (c) => AMBIGUOUS[c] ?? c);
  if (body.length !== CODE_BODY_LEN) return null;
  for (const c of body) if (!CROCKFORD_SET.has(c)) return null;
  return formatCodeBody(body);
}

export function codeLast4(code: string): string {
  const n = normalizeActivationCode(code);
  return n ? n.slice(-4) : "";
}

export function hashActivationCode(code: string, secret: string): string {
  const n = normalizeActivationCode(code);
  if (!n) throw new Error("invalid activation code");
  if (!secret) throw new Error("missing hashing secret");
  return crypto.createHmac("sha256", secret).update(n).digest("hex");
}

export function resolveCodeDays(kind: CodeDurationKind, days?: number): number {
  if (kind === "month") return 30;
  if (kind === "year") return 365;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new Error("عدد الأيام لازم يكون بين 1 و 3650");
  return n;
}

export function paymentIntervalForDays(days: number): "month" | "year" | "custom" {
  if (days === 365) return "year";
  if (days === 30) return "month";
  return "custom";
}

const RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };

/** Same plan (still active) extends expiry; upgrade starts from now. Never downgrade a higher active plan. */
export function applyCodeToPlan(opts: {
  codePlan: PaidPlan;
  days: number;
  currentPlan: PlanId;
  planRenewsAt?: number;
  now?: number;
}): { plan: PlanId; planRenewsAt: number; extended: boolean } {
  const now = opts.now ?? Date.now();
  const active = opts.currentPlan !== "free" && (opts.planRenewsAt ?? 0) > now;
  if (active && RANK[opts.currentPlan] >= RANK[opts.codePlan]) {
    const start = Math.max(now, opts.planRenewsAt ?? 0);
    return { plan: opts.currentPlan, planRenewsAt: start + opts.days * DAY, extended: true };
  }
  return { plan: opts.codePlan, planRenewsAt: now + opts.days * DAY, extended: false };
}

export type CodeStatus = "unused" | "used" | "expired" | "disabled";

export function codeStatus(code: ActivationCode, batchDisabled: boolean, now = Date.now()): CodeStatus {
  if (code.disabled || batchDisabled) return "disabled";
  if (code.uses >= code.maxUses) return "used";
  if (code.expiresAt && code.expiresAt <= now) return "expired";
  return "unused";
}

export function batchStats(codes: ActivationCode[], batchDisabled: boolean, now = Date.now()) {
  const out = { total: codes.length, used: 0, unused: 0, expired: 0, disabled: 0 };
  for (const c of codes) {
    const s = codeStatus(c, batchDisabled, now);
    out[s]++;
  }
  return out;
}

export function whyUnredeemable(code: ActivationCode | undefined, batch: ActivationBatch | undefined, now = Date.now()): "invalid" | "used" | "expired" | "disabled" | null {
  if (!code || !batch) return "invalid";
  if (code.disabled || batch.disabled) return "disabled";
  if (code.uses >= code.maxUses) return "used";
  const exp = code.expiresAt ?? batch.expiresAt;
  if (exp && exp <= now) return "expired";
  return null;
}

export function alreadyRedeemedBy(code: ActivationCode, userId: string): boolean {
  return code.redemptions.some((r) => r.userId === userId);
}


export interface RedeemUser {
  id: string;
  email: string;
  plan: PlanId;
  planRenewsAt?: number;
}

export interface RedeemPayment {
  id: string;
  userId: string;
  plan: PaidPlan;
  interval: "month" | "year" | "custom";
  amount: number;
  currency: string;
  provider: "code";
  status: "paid";
  createdAt: number;
  providerRef?: string;
  batchLabel?: string;
}

export type RedeemApplyResult =
  | { ok: true; code: ActivationCode; plan: PlanId; planRenewsAt: number; payment: RedeemPayment; extended: boolean }
  | { ok: false; reason: "invalid" | "used" | "expired" | "disabled" | "already" };

/** Pure in-memory redeem used by the store and by tests (atomic on a single state object). */
export function applyRedeemToState(
  state: { codes: ActivationCode[]; batches: ActivationBatch[]; users: RedeemUser[]; payments: RedeemPayment[] },
  opts: { hash: string; user: RedeemUser; now?: number; paymentId: string },
): RedeemApplyResult {
  const now = opts.now ?? Date.now();
  const code = state.codes.find((c) => c.hash === opts.hash);
  const batch = code ? state.batches.find((b) => b.id === code.batchId) : undefined;
  const why = whyUnredeemable(code, batch, now);
  if (why || !code || !batch) return { ok: false, reason: why ?? "invalid" };
  if (alreadyRedeemedBy(code, opts.user.id)) return { ok: false, reason: "already" };
  const user = state.users.find((u) => u.id === opts.user.id);
  if (!user) return { ok: false, reason: "invalid" };
  const next = applyCodeToPlan({ codePlan: code.plan, days: code.days, currentPlan: user.plan, planRenewsAt: user.planRenewsAt, now });
  code.uses += 1;
  code.redemptions = code.redemptions.concat([{ userId: user.id, email: user.email.toLowerCase(), at: now }]);
  user.plan = next.plan;
  user.planRenewsAt = next.planRenewsAt;
  const payment: RedeemPayment = {
    id: opts.paymentId,
    userId: user.id,
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
  state.payments.push(payment);
  return { ok: true, code, plan: next.plan, planRenewsAt: next.planRenewsAt, payment, extended: next.extended };
}

/* ---------- brute-force gate (in-memory; injectable clock for tests) ---------- */

interface RedeemBucket {
  attempts: number[];
  lockedUntil?: number;
}
const g = globalThis as unknown as { __frostlyRedeemRL?: Map<string, RedeemBucket> };
const buckets = () => (g.__frostlyRedeemRL ??= new Map<string, RedeemBucket>());

export function resetRedeemRateForTests() {
  buckets().clear();
}

export function redeemRateState(key: string, now = Date.now()): { allowed: boolean; lockedUntil?: number; remaining: number } {
  const b = buckets().get(key) ?? { attempts: [] };
  if (b.lockedUntil && b.lockedUntil > now) return { allowed: false, lockedUntil: b.lockedUntil, remaining: 0 };
  const attempts = b.attempts.filter((t) => now - t < REDEEM_WINDOW_MS);
  const remaining = Math.max(0, REDEEM_MAX_ATTEMPTS - attempts.length);
  return { allowed: remaining > 0, remaining };
}

/** Record an attempt (failed or otherwise). After 5 in 10 minutes the key locks for 1 hour. */
export function recordRedeemAttempt(key: string, now = Date.now()): { allowed: boolean; lockedUntil?: number; remaining: number } {
  const map = buckets();
  const prev = map.get(key) ?? { attempts: [] };
  if (prev.lockedUntil && prev.lockedUntil > now) return { allowed: false, lockedUntil: prev.lockedUntil, remaining: 0 };
  const attempts = prev.attempts.filter((t) => now - t < REDEEM_WINDOW_MS);
  attempts.push(now);
  const b: RedeemBucket = { attempts };
  if (attempts.length >= REDEEM_MAX_ATTEMPTS) b.lockedUntil = now + REDEEM_LOCK_MS;
  map.set(key, b);
  if (map.size > 50_000) {
    for (const [k, v] of map) {
      if ((v.lockedUntil ?? 0) < now && (!v.attempts.length || now - v.attempts[v.attempts.length - 1] > REDEEM_WINDOW_MS)) map.delete(k);
    }
  }
  return b.lockedUntil
    ? { allowed: false, lockedUntil: b.lockedUntil, remaining: 0 }
    : { allowed: true, remaining: Math.max(0, REDEEM_MAX_ATTEMPTS - attempts.length) };
}

export const GENERIC_REDEEM_ERROR = {
  ar: "تعذر تفعيل الكود. تأكد منه أو جرّب لاحقاً.",
  en: "We couldn't redeem this code. Check it and try again.",
};

export const REDEEM_RATE_ERROR = {
  ar: "محاولات كثيرة. جرّب بعد ساعة.",
  en: "Too many attempts. Try again in an hour.",
};
