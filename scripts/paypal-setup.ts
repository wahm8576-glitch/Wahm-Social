/**
 * Create Frostly Pro / Business PayPal products and monthly/yearly USD plans,
 * plus a webhook subscription. Prints plan ids and the webhook id.
 *
 * Usage:
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_ENV=live npx tsx scripts/paypal-setup.ts
 *
 * Never commit the printed secrets. PAYPAL_ENV is `sandbox` (default) or `live`.
 */
import { PLANS } from "../src/lib/plans";

const which = process.env.PAYPAL_ENV === "live" || process.env.PAYPAL_ENV === "production" ? "live" : "sandbox";
const base = which === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
const secret = process.env.PAYPAL_CLIENT_SECRET ?? "";
function siteOrigin(): string {
  const raw = (process.env.PAYPAL_WEBHOOK_URL || process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL || "").trim();
  return raw.replace(/\/$/, "");
}
const webhookUrl = process.env.PAYPAL_WEBHOOK_URL
  || (siteOrigin() ? `${siteOrigin()}/api/billing/paypal/webhook` : "");

if (!clientId || !secret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
  process.exit(1);
}
if (!webhookUrl) {
  console.error("Set SITE_URL or PAYPAL_WEBHOOK_URL to the public site origin (e.g. https://example.com)");
  process.exit(1);
}

async function token(): Promise<string> {
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    console.error("PayPal auth failed:", json.error_description ?? res.status);
    process.exit(1);
  }
  return json.access_token;
}

async function api<T>(path: string, method: string, body?: unknown, access = ""): Promise<T> {
  const t = access || (await token());
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { message?: string; details?: { description?: string }[] };
  if (!res.ok) {
    console.error(method, path, res.status, json.message ?? json.details ?? json);
    process.exit(1);
  }
  return json;
}

type CatalogProduct = { id: string; name?: string };
type Plan = { id: string; name?: string; product_id?: string };
type Webhook = { id: string; url?: string };

function money(n: number) {
  return { currency_code: "USD", value: n.toFixed(2) };
}

function billingCycles(interval: "MONTH" | "YEAR", amount: number) {
  return [
    {
      frequency: { interval_unit: interval, interval_count: 1 },
      tenure_type: "REGULAR",
      sequence: 1,
      total_cycles: 0,
      pricing_scheme: { fixed_price: money(amount) },
    },
  ];
}

async function findOrCreateProduct(access: string, name: string, description: string): Promise<string> {
  const list = await api<{ products?: CatalogProduct[] }>("/v1/catalogs/products?page_size=20", "GET", undefined, access);
  const existing = (list.products ?? []).find((p) => p.name === name);
  if (existing) {
    console.error(`Reusing product ${name} (${existing.id})`);
    return existing.id;
  }
  const created = await api<CatalogProduct>(
    "/v1/catalogs/products",
    "POST",
    { name, description, type: "SERVICE", category: "SOFTWARE" },
    access,
  );
  console.error(`Created product ${name} (${created.id})`);
  return created.id;
}

async function findOrCreatePlan(access: string, productId: string, name: string, interval: "MONTH" | "YEAR", amount: number): Promise<string> {
  const list = await api<{ plans?: Plan[] }>(`/v1/billing/plans?product_id=${encodeURIComponent(productId)}&page_size=20`, "GET", undefined, access);
  const existing = (list.plans ?? []).find((p) => p.name === name);
  if (existing) {
    console.error(`Reusing plan ${name} (${existing.id})`);
    return existing.id;
  }
  const created = await api<Plan>(
    "/v1/billing/plans",
    "POST",
    {
      product_id: productId,
      name,
      description: name,
      status: "ACTIVE",
      billing_cycles: billingCycles(interval, amount),
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    },
    access,
  );
  console.error(`Created plan ${name} (${created.id})`);
  return created.id;
}

const EVENTS = [
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "PAYMENT.SALE.COMPLETED",
];

async function findOrCreateWebhook(access: string): Promise<string> {
  const list = await api<{ webhooks?: Webhook[] }>("/v1/notifications/webhooks", "GET", undefined, access);
  const existing = (list.webhooks ?? []).find((w) => w.url === webhookUrl);
  if (existing) {
    console.error(`Reusing webhook ${existing.id} -> ${webhookUrl}`);
    return existing.id;
  }
  const created = await api<Webhook>(
    "/v1/notifications/webhooks",
    "POST",
    { url: webhookUrl, event_types: EVENTS.map((name) => ({ name })) },
    access,
  );
  console.error(`Created webhook ${created.id} -> ${webhookUrl}`);
  return created.id;
}

async function main() {
  const access = await token();
  const proId = await findOrCreateProduct(access, "Frostly Pro", "Frostly Pro subscription");
  const bizId = await findOrCreateProduct(access, "Frostly Business", "Frostly Business subscription");
  const ids = {
    PAYPAL_PLAN_PRO_MONTHLY: await findOrCreatePlan(access, proId, "Frostly Pro monthly", "MONTH", PLANS.pro.priceMonthly),
    PAYPAL_PLAN_PRO_YEARLY: await findOrCreatePlan(access, proId, "Frostly Pro yearly", "YEAR", PLANS.pro.priceYearly),
    PAYPAL_PLAN_BIZ_MONTHLY: await findOrCreatePlan(access, bizId, "Frostly Business monthly", "MONTH", PLANS.business.priceMonthly),
    PAYPAL_PLAN_BIZ_YEARLY: await findOrCreatePlan(access, bizId, "Frostly Business yearly", "YEAR", PLANS.business.priceYearly),
  };
  const webhookId = await findOrCreateWebhook(access);
  console.log("# Add these to Render env / admin secrets / .env.local (do not commit)");
  console.log(`PAYPAL_ENV=${which}`);
  for (const [k, v] of Object.entries(ids)) console.log(`${k}=${v}`);
  console.log(`PAYPAL_WEBHOOK_ID=${webhookId}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
