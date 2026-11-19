/**
 * Telegram Stars short-lived signed checkout payloads and payment application.
 * Payloads stay under 64 chars so they also fit t.me/<bot>?start=.
 */
import crypto from "node:crypto";
import type { PlanId } from "@/lib/plans";
export type { PaidPlan, PaidInterval, StarPriceKey, StarPrices } from "./star-prices";
export {
  STAR_PERIOD_MONTH_SEC,
  STAR_PAYLOAD_TTL_SEC,
  TELEGRAM_BOT_USERNAME_DEFAULT,
  niceStarPrice,
  DEFAULT_STAR_PRICES,
  starPriceKey,
  effectiveStarPrices,
} from "./star-prices";
import { STAR_PAYLOAD_TTL_SEC, TELEGRAM_BOT_USERNAME_DEFAULT } from "./star-prices";
import type { PaidPlan, PaidInterval } from "./star-prices";

export interface StarPayload {
  userId: string;
  plan: PaidPlan;
  interval: PaidInterval;
  stars: number;
  exp: number;
  nonce: string;
}

const PLAN_CH: Record<PaidPlan, string> = { pro: "p", business: "b" };
const INT_CH: Record<PaidInterval, string> = { month: "m", year: "y" };
const PLAN_FROM: Record<string, PaidPlan> = { p: "pro", b: "business" };
const INT_FROM: Record<string, PaidInterval> = { m: "month", y: "year" };

export class StarPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StarPayloadError";
  }
}

function mac16(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url").slice(0, 16);
}

export function signStarPayload(data: StarPayload, secret: string): string {
  if (!secret) throw new StarPayloadError("missing signing secret");
  if (!data.userId || data.userId.length > 32) throw new StarPayloadError("invalid user");
  if (!Number.isInteger(data.stars) || data.stars < 1 || data.stars > 1_000_000) throw new StarPayloadError("invalid stars");
  const body = `${data.userId}.${PLAN_CH[data.plan]}${INT_CH[data.interval]}.${data.stars}.${data.exp}.${data.nonce}`;
  const token = `${body}.${mac16(secret, body)}`;
  if (Buffer.byteLength(token, "utf8") > 128) throw new StarPayloadError("payload too long");
  return token;
}

export function verifyStarPayload(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): StarPayload {
  if (!token || !secret) throw new StarPayloadError("invalid payload");
  const parts = token.split(".");
  if (parts.length !== 6) throw new StarPayloadError("invalid payload");
  const [userId, pi, starsRaw, expRaw, nonce, mac] = parts;
  const body = `${userId}.${pi}.${starsRaw}.${expRaw}.${nonce}`;
  const expected = mac16(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(mac ?? "");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new StarPayloadError("invalid signature");
  const plan = PLAN_FROM[pi[0] ?? ""];
  const interval = INT_FROM[pi[1] ?? ""];
  const stars = Number(starsRaw);
  const exp = Number(expRaw);
  if (!plan || !interval || !userId || !Number.isInteger(stars) || !Number.isInteger(exp) || !nonce) {
    throw new StarPayloadError("invalid payload");
  }
  if (exp < nowSec) throw new StarPayloadError("expired");
  return { userId, plan, interval, stars, exp, nonce };
}

export function newStarPayload(input: Omit<StarPayload, "exp" | "nonce">, nowMs = Date.now()): StarPayload {
  return {
    ...input,
    exp: Math.floor(nowMs / 1000) + STAR_PAYLOAD_TTL_SEC,
    nonce: crypto.randomBytes(4).toString("base64url"),
  };
}

export function deepLink(botUsername: string, payload: string): string {
  const name = botUsername.replace(/^@/, "") || TELEGRAM_BOT_USERNAME_DEFAULT;
  return `https://t.me/${name}?start=${encodeURIComponent(payload)}`;
}

export interface StarsPaymentEvent {
  invoice_payload?: string;
  currency?: string;
  total_amount?: number;
  telegram_payment_charge_id?: string;
  telegram_payment_chargeId?: string;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
  subscription_expiration_date?: number;
}

export interface StarsUser {
  id: string;
  plan?: PlanId;
  planRenewsAt?: number;
  telegramUserId?: number;
}

export interface StarsStores {
  findUser(id: string): StarsUser | undefined;
  updateUser(id: string, patch: Partial<StarsUser> & { plan: PlanId }): void;
  addPayment(p: {
    userId: string;
    plan: PaidPlan;
    interval: PaidInterval;
    amount: number;
    currency: "XTR";
    provider: "telegram_stars";
    status: "paid";
    providerRef?: string;
    eventId?: string;
    telegramUserId?: number;
  }): void;
  seenCharge(id: string): boolean;
  markCharge(id: string): void;
}

export function renewsAtFromPayment(ev: StarsPaymentEvent, interval: PaidInterval, now = Date.now()): number {
  if (ev.subscription_expiration_date && ev.subscription_expiration_date > 0) {
    return ev.subscription_expiration_date * 1000;
  }
  return now + (interval === "year" ? 365 : 30) * 86_400_000;
}

export function applyStarsPayment(
  ev: StarsPaymentEvent,
  stores: StarsStores,
  secret: string,
  opts: { telegramUserId?: number; now?: number } = {},
): { ok: true; skipped?: string; userId: string } {
  const now = opts.now ?? Date.now();
  const charge = ev.telegram_payment_charge_id || ev.telegram_payment_chargeId || "";
  if (charge && stores.seenCharge(charge)) return { ok: true, skipped: "duplicate", userId: "" };
  if (ev.currency && ev.currency !== "XTR") throw new StarPayloadError("unexpected currency");
  const data = verifyStarPayload(String(ev.invoice_payload ?? ""), secret, 0); // expiry is for checkout, not renewals
  if (typeof ev.total_amount === "number" && ev.total_amount !== data.stars) throw new StarPayloadError("amount mismatch");
  const user = stores.findUser(data.userId);
  if (!user) throw new StarPayloadError("unknown user");
  if (charge) stores.markCharge(charge);
  const renews = renewsAtFromPayment(ev, data.interval, now);
  stores.updateUser(user.id, {
    plan: data.plan,
    planRenewsAt: renews,
    telegramUserId: opts.telegramUserId ?? user.telegramUserId,
  });
  stores.addPayment({
    userId: user.id,
    plan: data.plan,
    interval: data.interval,
    amount: ev.total_amount ?? data.stars,
    currency: "XTR",
    provider: "telegram_stars",
    status: "paid",
    providerRef: charge || undefined,
    eventId: charge || undefined,
    telegramUserId: opts.telegramUserId,
  });
  return { ok: true, userId: user.id };
}

export function preCheckoutDecision(
  ev: { invoice_payload?: string; currency?: string; total_amount?: number },
  secret: string,
  findUser: (id: string) => StarsUser | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): { ok: true; data: StarPayload } | { ok: false; error: string } {
  try {
    if (ev.currency && ev.currency !== "XTR") return { ok: false, error: "عملة غير مدعومة" };
    const data = verifyStarPayload(String(ev.invoice_payload ?? ""), secret, nowSec);
    if (typeof ev.total_amount === "number" && ev.total_amount !== data.stars) return { ok: false, error: "المبلغ غير مطابق" };
    if (!findUser(data.userId)) return { ok: false, error: "الحساب غير موجود" };
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof StarPayloadError ? e.message : "invalid";
    if (msg === "expired") return { ok: false, error: "انتهت صلاحية رابط الدفع. ابدأ من الموقع مرة أخرى." };
    return { ok: false, error: "رابط الدفع غير صالح" };
  }
}
