import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { billingMode } from "../src/lib/env";
import { applyPaypalEvent, isPaypalCertUrl, readPaypalWebhookHeaders, type EventStores, type BillingUser } from "../src/lib/billing/paypal";
import { computeRenewsAt, endOfDayRiyadh, grantPatch, GrantError } from "../src/lib/billing/admin-grant";

const KEYS = [
  "NODE_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "PAYPAL_PLAN_PRO_MONTHLY",
  "PAYPAL_PLAN_PRO_YEARLY",
  "PAYPAL_PLAN_BIZ_MONTHLY",
  "PAYPAL_PLAN_BIZ_YEARLY",
];

const saved: Record<string, string | undefined> = {};

function setEnv(k: string, v: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (v === undefined) delete env[k];
  else env[k] = v;
}

function clearBillingEnv() {
  for (const k of KEYS) delete process.env[k];
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  clearBillingEnv();
});

afterEach(() => {
  clearBillingEnv();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("billingMode", () => {
  test("paypal wins when client id and secret are set", () => {
    setEnv("NODE_ENV", "production");
    process.env.PAYPAL_CLIENT_ID = "id";
    process.env.PAYPAL_CLIENT_SECRET = "secret";
    process.env.STRIPE_SECRET_KEY = "sk_test";
    assert.equal(billingMode(), "paypal");
  });

  test("stripe when PayPal is unset and Stripe is set", () => {
    setEnv("NODE_ENV", "production");
    process.env.STRIPE_SECRET_KEY = "sk_live";
    assert.equal(billingMode(), "stripe");
  });

  test("off in production when no provider is configured (no free mock upgrades)", () => {
    setEnv("NODE_ENV", "production");
    assert.equal(billingMode(), "off");
  });

  test("mock only in non-production when no provider is configured", () => {
    setEnv("NODE_ENV", "development");
    assert.equal(billingMode(), "mock");
    setEnv("NODE_ENV", "test");
    assert.equal(billingMode(), "mock");
  });
});

describe("PayPal webhook helpers", () => {
  test("readPaypalWebhookHeaders requires every transmission field", () => {
    assert.equal(readPaypalWebhookHeaders(new Headers()), null);
    const h = new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
      "paypal-transmission-id": "tid",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2026-11-19T00:00:00Z",
    });
    const got = readPaypalWebhookHeaders(h);
    assert.ok(got);
    assert.equal(got!.transmissionId, "tid");
  });

  test("isPaypalCertUrl allows only PayPal hosts over https", () => {
    process.env.PAYPAL_ENV = "sandbox";
    assert.equal(isPaypalCertUrl("https://api.sandbox.paypal.com/cert.pem", "sandbox"), true);
    assert.equal(isPaypalCertUrl("https://evil.example/cert.pem", "sandbox"), false);
    assert.equal(isPaypalCertUrl("http://api.sandbox.paypal.com/cert.pem", "sandbox"), false);
    assert.equal(isPaypalCertUrl("https://api.paypal.com/cert.pem", "live"), true);
    assert.equal(isPaypalCertUrl("https://api.sandbox.paypal.com/cert.pem", "live"), false);
  });
});

function memoryStores(users: BillingUser[]) {
  const events = new Set<string>();
  const payments: Record<string, unknown>[] = [];
  const stores: EventStores & { payments: Record<string, unknown>[] } = {
    payments,
    findUser(q) {
      return users.find((u) => (q.id && u.id === q.id) || (q.email && u.email === q.email) || (q.subscriptionId && u.paypalSubscriptionId === q.subscriptionId));
    },
    updateUser(id, patch) {
      const u = users.find((x) => x.id === id);
      if (u) Object.assign(u, patch);
    },
    addPayment(p) {
      payments.push(p);
    },
    seenEvent(id) {
      return events.has(id);
    },
    markEvent(id) {
      events.add(id);
    },
  };
  return stores;
}

describe("applyPaypalEvent", () => {
  const planId = "P-PRO-MONTH";

  beforeEach(() => {
    process.env.PAYPAL_PLAN_PRO_MONTHLY = planId;
  });

  test("subscription.activated upgrades the user from custom_id", () => {
    const users: BillingUser[] = [{ id: "u_1", email: "a@x.com", plan: "free" }];
    const stores = memoryStores(users);
    const out = applyPaypalEvent(
      {
        id: "WH-1",
        event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
        resource: {
          id: "I-ABC",
          plan_id: planId,
          custom_id: "u_1",
          status: "ACTIVE",
          billing_info: { next_billing_time: "2026-12-19T00:00:00Z" },
        },
      },
      stores,
    );
    assert.equal(out.ok, true);
    assert.equal(users[0].plan, "pro");
    assert.equal(users[0].paypalSubscriptionId, "I-ABC");
    assert.equal(users[0].planRenewsAt, Date.parse("2026-12-19T00:00:00Z"));
  });

  test("duplicate event id is ignored", () => {
    const users: BillingUser[] = [{ id: "u_1", email: "a@x.com", plan: "free" }];
    const stores = memoryStores(users);
    const ev = {
      id: "WH-DUP",
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      resource: { id: "I-1", plan_id: planId, custom_id: "u_1", status: "ACTIVE" },
    };
    applyPaypalEvent(ev, stores);
    users[0].plan = "business";
    const again = applyPaypalEvent(ev, stores);
    assert.equal(again.skipped, "duplicate");
    assert.equal(users[0].plan, "business", "second delivery must not overwrite");
  });

  test("cancelled keeps access until current period end", () => {
    const ends = Date.now() + 10 * 864e5;
    const users: BillingUser[] = [{ id: "u_1", email: "a@x.com", plan: "pro", planRenewsAt: ends, paypalSubscriptionId: "I-1" }];
    const stores = memoryStores(users);
    applyPaypalEvent({ id: "WH-C", event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-1" } }, stores);
    assert.equal(users[0].plan, "pro");
    assert.equal(users[0].planRenewsAt, ends);
  });

  test("expired downgrades immediately", () => {
    const users: BillingUser[] = [{ id: "u_1", email: "a@x.com", plan: "pro", planRenewsAt: Date.now() + 864e5, paypalSubscriptionId: "I-1" }];
    const stores = memoryStores(users);
    applyPaypalEvent({ id: "WH-E", event_type: "BILLING.SUBSCRIPTION.EXPIRED", resource: { id: "I-1" } }, stores);
    assert.equal(users[0].plan, "free");
  });

  test("sale.completed records a PayPal payment", () => {
    const users: BillingUser[] = [{ id: "u_1", email: "a@x.com", plan: "pro", paypalSubscriptionId: "I-1" }];
    const stores = memoryStores(users);
    applyPaypalEvent(
      {
        id: "WH-P",
        event_type: "PAYMENT.SALE.COMPLETED",
        resource: { id: "SALE-1", billing_agreement_id: "I-1", amount: { total: "7.99", currency: "USD" } },
      },
      stores,
    );
    assert.equal(stores.payments.length, 1);
    assert.equal(stores.payments[0].provider, "paypal");
    assert.equal(stores.payments[0].amount, 7.99);
    assert.equal(stores.payments[0].currency, "USD");
    assert.equal(stores.payments[0].userId, "u_1");
  });
});

describe("admin grant", () => {
  const now = Date.parse("2026-11-19T12:00:00+03:00");

  test("month and year durations from now", () => {
    assert.equal(computeRenewsAt({ plan: "pro", duration: "month" }, now), now + 30 * 864e5);
    assert.equal(computeRenewsAt({ plan: "business", duration: "year" }, now), now + 365 * 864e5);
  });

  test("custom days and until-date (end of day Asia/Riyadh)", () => {
    assert.equal(computeRenewsAt({ plan: "pro", duration: "days", days: 10 }, now), now + 10 * 864e5);
    const until = endOfDayRiyadh("2026-12-01");
    assert.equal(new Date(until + 3 * 3600_000).toISOString().startsWith("2026-12-01T23:59:59"), true);
    assert.equal(computeRenewsAt({ plan: "pro", duration: "until", until: "2026-12-01" }, now), until);
  });

  test("extend adds on top of a future expiry", () => {
    const existing = now + 5 * 864e5;
    const got = computeRenewsAt({ plan: "pro", duration: "days", days: 10, extend: true }, now, existing);
    assert.equal(got, existing + 10 * 864e5);
  });

  test("revoke (free) clears renewal", () => {
    const patch = grantPatch({ plan: "free", duration: "month" }, now, { userId: "u", plan: "pro", planRenewsAt: now + 864e5 });
    assert.equal(patch.plan, "free");
    assert.equal(patch.planRenewsAt, undefined);
  });

  test("rejects past until-date and bad day counts", () => {
    assert.throws(() => computeRenewsAt({ plan: "pro", duration: "until", until: "2020-01-01" }, now), GrantError);
    assert.throws(() => computeRenewsAt({ plan: "pro", duration: "days", days: 0 }, now), GrantError);
    assert.throws(() => endOfDayRiyadh("not-a-date"), GrantError);
  });

  test("custom duration records interval custom", () => {
    const patch = grantPatch({ plan: "pro", duration: "days", days: 14 }, now, { userId: "u" });
    assert.equal(patch.interval, "custom");
    assert.equal(patch.plan, "pro");
  });
});
