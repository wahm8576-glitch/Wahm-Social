/**
 * PayPal Subscriptions API helpers (server). Signature verification talks to PayPal;
 * event application is a pure function so it can be unit-tested.
 */
import { env } from "@/lib/env";
import type { PlanId } from "@/lib/plans";
import { PlatformError } from "@/lib/platforms/types";

export type PaypalEnv = "sandbox" | "live";

export function paypalApiBase(which: PaypalEnv = env.paypalEnv): string {
  return which === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export function paypalPlanId(plan: "pro" | "business", interval: "month" | "year"): string {
  if (plan === "pro") return interval === "year" ? env.paypalPlanProYearly : env.paypalPlanProMonthly;
  return interval === "year" ? env.paypalPlanBizYearly : env.paypalPlanBizMonthly;
}

export function planFromPaypalPlanId(planId: string | undefined): { plan: "pro" | "business"; interval: "month" | "year" } | null {
  if (!planId) return null;
  const map: [string, "pro" | "business", "month" | "year"][] = [
    [env.paypalPlanProMonthly, "pro", "month"],
    [env.paypalPlanProYearly, "pro", "year"],
    [env.paypalPlanBizMonthly, "business", "month"],
    [env.paypalPlanBizYearly, "business", "year"],
  ];
  for (const [id, plan, interval] of map) if (id && id === planId) return { plan, interval };
  return null;
}

let cached: { value: string; exp: number } | null = null;

export async function paypalAccessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 10_000) return cached.value;
  const id = env.paypalClientId;
  const secret = env.paypalClientSecret;
  if (!id || !secret) throw new PlatformError("internal", "PayPal is not configured", 503);
  const res = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new PlatformError("upstream_error", json.error_description ?? "PayPal auth failed", 502);
  cached = { value: json.access_token, exp: Date.now() + Math.max(30, (json.expires_in ?? 300) - 60) * 1000 };
  return json.access_token;
}

export async function paypalFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await paypalAccessToken();
  const res = await fetch(`${paypalApiBase()}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as T & { message?: string; error_description?: string; details?: { description?: string }[] };
  if (!res.ok) {
    const detail = json.details?.[0]?.description || json.message || json.error_description || "PayPal error";
    throw new PlatformError("upstream_error", detail, 502);
  }
  return json;
}

export type PaypalWebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export function readPaypalWebhookHeaders(h: Headers): PaypalWebhookHeaders | null {
  const authAlgo = h.get("paypal-auth-algo") ?? "";
  const certUrl = h.get("paypal-cert-url") ?? "";
  const transmissionId = h.get("paypal-transmission-id") ?? "";
  const transmissionSig = h.get("paypal-transmission-sig") ?? "";
  const transmissionTime = h.get("paypal-transmission-time") ?? "";
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return null;
  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime };
}

/** Accept only PayPal certificate hosts (the verify API fetches cert_url). */
export function isPaypalCertUrl(url: string, which: PaypalEnv = env.paypalEnv): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    const allowed =
      which === "live"
        ? ["api.paypal.com", "api-m.paypal.com"]
        : ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"];
    return allowed.includes(host);
  } catch {
    return false;
  }
}

export async function verifyPaypalWebhook(rawBody: string, headers: PaypalWebhookHeaders, webhookId = env.paypalWebhookId): Promise<boolean> {
  if (!webhookId || !isPaypalCertUrl(headers.certUrl)) return false;
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return false;
  }
  try {
    const json = await paypalFetch<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    return json.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

export interface PaypalEvent {
  id?: string;
  event_type?: string;
  resource?: Record<string, unknown>;
}

export interface BillingUser {
  id: string;
  email: string;
  plan?: PlanId;
  planRenewsAt?: number;
  paypalSubscriptionId?: string;
}

export interface EventStores {
  findUser(q: { id?: string; email?: string; subscriptionId?: string }): BillingUser | undefined;
  updateUser(id: string, patch: Partial<BillingUser> & { plan: PlanId; planRenewsAt?: number; paypalSubscriptionId?: string }): void;
  addPayment(p: { userId: string; plan: PlanId; interval: "month" | "year" | "custom"; amount: number; currency: string; provider: "paypal"; status: "paid"; eventId?: string; providerRef?: string }): void;
  seenEvent(id: string): boolean;
  markEvent(id: string, type: string): void;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numDate(v: unknown): number | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function money(resource: Record<string, unknown>): { amount: number; currency: string } {
  const amountObj = (resource.amount ?? (resource.billing_info as Record<string, unknown> | undefined)?.last_payment) as Record<string, unknown> | undefined;
  const inner = (amountObj?.amount as Record<string, unknown> | undefined) ?? amountObj;
  const raw = inner?.value ?? inner?.total ?? resource.amount_with_breakdown;
  const n = typeof raw === "string" || typeof raw === "number" ? Number(raw) : 0;
  const currency = str(inner?.currency_code ?? inner?.currency ?? "USD") || "USD";
  return { amount: Number.isFinite(n) ? n : 0, currency: currency.toUpperCase() };
}

function customId(resource: Record<string, unknown>): string {
  return str(resource.custom_id) || str(resource.custom) || "";
}

function nextRenews(resource: Record<string, unknown>, interval: "month" | "year"): number {
  const info = (resource.billing_info as Record<string, unknown> | undefined) ?? {};
  return numDate(info.next_billing_time) ?? Date.now() + (interval === "year" ? 365 : 30) * 86_400_000;
}

export function applyPaypalEvent(event: PaypalEvent, stores: EventStores): { ok: true; skipped?: string } {
  const eventId = str(event.id);
  const type = str(event.event_type);
  if (eventId && stores.seenEvent(eventId)) return { ok: true, skipped: "duplicate" };
  if (eventId) stores.markEvent(eventId, type);
  const resource = event.resource ?? {};
  const subId = str(resource.id).startsWith("I-") ? str(resource.id) : str(resource.billing_agreement_id);
  const mapped = planFromPaypalPlanId(str(resource.plan_id));
  const user =
    stores.findUser({ id: customId(resource) }) ||
    stores.findUser({ subscriptionId: subId }) ||
    stores.findUser({ email: str((resource.subscriber as Record<string, unknown> | undefined)?.email_address) });

  if (type === "BILLING.SUBSCRIPTION.ACTIVATED" || type === "BILLING.SUBSCRIPTION.UPDATED") {
    if (!user) return { ok: true, skipped: "no_user" };
    const status = str(resource.status).toUpperCase();
    if (status === "CANCELLED" || status === "EXPIRED") {
      const ends = nextRenews(resource, mapped?.interval ?? "month");
      stores.updateUser(user.id, {
        plan: ends > Date.now() ? (mapped?.plan ?? user.plan ?? "pro") : "free",
        planRenewsAt: ends > Date.now() ? ends : Date.now(),
        paypalSubscriptionId: subId || user.paypalSubscriptionId,
      });
      return { ok: true };
    }
    const plan = mapped?.plan ?? (user.plan !== "free" ? (user.plan as "pro" | "business") : "pro");
    const interval = mapped?.interval ?? "month";
    stores.updateUser(user.id, {
      plan,
      planRenewsAt: nextRenews(resource, interval),
      paypalSubscriptionId: subId || user.paypalSubscriptionId,
    });
    return { ok: true };
  }

  if (type === "BILLING.SUBSCRIPTION.CANCELLED" || type === "BILLING.SUBSCRIPTION.EXPIRED" || type === "BILLING.SUBSCRIPTION.SUSPENDED") {
    if (!user) return { ok: true, skipped: "no_user" };
    const immediate = type === "BILLING.SUBSCRIPTION.EXPIRED";
    const ends = user.planRenewsAt && user.planRenewsAt > Date.now() && !immediate ? user.planRenewsAt : Date.now();
    stores.updateUser(user.id, {
      plan: immediate || ends <= Date.now() ? "free" : user.plan ?? "free",
      planRenewsAt: ends,
      paypalSubscriptionId: subId || user.paypalSubscriptionId,
    });
    return { ok: true };
  }

  if (type === "PAYMENT.SALE.COMPLETED" || type === "PAYMENT.CAPTURE.COMPLETED") {
    if (!user) return { ok: true, skipped: "no_user" };
    const plan = mapped?.plan ?? (user.plan !== "free" ? user.plan! : "pro");
    const interval = mapped?.interval ?? "month";
    const { amount, currency } = money(resource);
    stores.addPayment({
      userId: user.id,
      plan,
      interval,
      amount,
      currency,
      provider: "paypal",
      status: "paid",
      eventId: eventId || undefined,
      providerRef: str(resource.id) || undefined,
    });
    if (user.plan === "free" || !user.planRenewsAt) {
      stores.updateUser(user.id, {
        plan,
        planRenewsAt: nextRenews(resource, interval),
        paypalSubscriptionId: subId || user.paypalSubscriptionId,
      });
    }
    return { ok: true };
  }

  return { ok: true, skipped: "ignored" };
}
