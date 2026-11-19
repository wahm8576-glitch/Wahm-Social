import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyStarsPayment,
  deepLink,
  DEFAULT_STAR_PRICES,
  niceStarPrice,
  newStarPayload,
  preCheckoutDecision,
  signStarPayload,
  StarPayloadError,
  verifyStarPayload,
  type StarsUser,
} from "../src/lib/billing/stars";

const SECRET = "test-star-secret-please-change";

describe("star prices", () => {
  test("defaults are USD×77 rounded to friendly amounts", () => {
    assert.equal(DEFAULT_STAR_PRICES.proMonthly, 599);
    assert.equal(DEFAULT_STAR_PRICES.proYearly, 4599);
    assert.equal(DEFAULT_STAR_PRICES.bizMonthly, 2299);
    assert.equal(DEFAULT_STAR_PRICES.bizYearly, 19199);
    assert.equal(niceStarPrice(7.99), 599);
  });
});

describe("star payload signing", () => {
  test("round-trips and stays under 64 chars for start= deep links", () => {
    const data = newStarPayload({ userId: "u_abcdefghijk", plan: "pro", interval: "month", stars: 599 }, Date.parse("2026-11-19T03:00:00+03:00"));
    const token = signStarPayload(data, SECRET);
    assert.ok(Buffer.byteLength(token, "utf8") <= 64, token);
    const got = verifyStarPayload(token, SECRET, data.exp - 10);
    assert.equal(got.userId, data.userId);
    assert.equal(got.plan, "pro");
    assert.equal(got.interval, "month");
    assert.equal(got.stars, 599);
    assert.equal(got.nonce, data.nonce);
    assert.ok(deepLink("PaySubStarsBot", token).startsWith("https://t.me/PaySubStarsBot?start="));
  });

  test("rejects tampered, wrong secret, and expired payloads", () => {
    const data = newStarPayload({ userId: "u_1", plan: "business", interval: "year", stars: 19199 });
    const token = signStarPayload(data, SECRET);
    assert.throws(() => verifyStarPayload(token.slice(0, -1) + "x", SECRET), StarPayloadError);
    assert.throws(() => verifyStarPayload(token, "other-secret"), StarPayloadError);
    assert.throws(() => verifyStarPayload(token, SECRET, data.exp + 1), StarPayloadError);
  });
});

describe("pre_checkout and successful_payment", () => {
  const users: StarsUser[] = [{ id: "u_1", plan: "free" }];
  const find = (id: string) => users.find((u) => u.id === id);

  test("pre_checkout accepts a valid payload and rejects amount mismatch", () => {
    const data = newStarPayload({ userId: "u_1", plan: "pro", interval: "month", stars: 599 });
    const token = signStarPayload(data, SECRET);
    const ok = preCheckoutDecision({ invoice_payload: token, currency: "XTR", total_amount: 599 }, SECRET, find, data.exp - 1);
    assert.equal(ok.ok, true);
    const bad = preCheckoutDecision({ invoice_payload: token, currency: "XTR", total_amount: 1 }, SECRET, find, data.exp - 1);
    assert.equal(bad.ok, false);
  });

  test("successful_payment activates the plan and is idempotent by charge id", () => {
    const data = newStarPayload({ userId: "u_1", plan: "pro", interval: "month", stars: 599 });
    const token = signStarPayload(data, SECRET);
    const payments: Record<string, unknown>[] = [];
    const charges = new Set<string>();
    const stores = {
      payments,
      findUser: (id: string) => find(id),
      updateUser(id: string, patch: Partial<StarsUser>) {
        Object.assign(users.find((u) => u.id === id)!, patch);
      },
      addPayment(p: Record<string, unknown>) {
        payments.push(p);
      },
      seenCharge: (id: string) => charges.has(id),
      markCharge: (id: string) => {
        charges.add(id);
      },
    };
    const exp = Math.floor(Date.parse("2026-12-19T00:00:00Z") / 1000);
    const ev = {
      invoice_payload: token,
      currency: "XTR" as const,
      total_amount: 599,
      telegram_payment_charge_id: "chg_1",
      is_first_recurring: true,
      subscription_expiration_date: exp,
    };
    const out = applyStarsPayment(ev, stores as any, SECRET, { telegramUserId: 42, now: Date.parse("2026-11-19T00:00:00Z") });
    assert.equal(out.ok, true);
    assert.equal(users[0].plan, "pro");
    assert.equal(users[0].telegramUserId, 42);
    assert.equal(users[0].planRenewsAt, exp * 1000);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].provider, "telegram_stars");
    assert.equal(payments[0].currency, "XTR");
    const again = applyStarsPayment(ev, stores as any, SECRET, { telegramUserId: 42 });
    assert.equal(again.skipped, "duplicate");
    assert.equal(payments.length, 1);
  });

  test("recurring payment with expired checkout payload still extends the period", () => {
    users[0] = { id: "u_1", plan: "pro", planRenewsAt: Date.parse("2026-12-01T00:00:00Z"), telegramUserId: 42 };
    const stale = signStarPayload({ userId: "u_1", plan: "pro", interval: "month", stars: 599, exp: 1_000_000_000, nonce: "n1" }, SECRET);
    const payments: Record<string, unknown>[] = [];
    const charges = new Set<string>();
    const stores = {
      findUser: (id: string) => find(id),
      updateUser(id: string, patch: Partial<StarsUser>) {
        Object.assign(users.find((u) => u.id === id)!, patch);
      },
      addPayment(p: Record<string, unknown>) {
        payments.push(p);
      },
      seenCharge: (id: string) => charges.has(id),
      markCharge: (id: string) => {
        charges.add(id);
      },
    };
    const exp2 = Math.floor(Date.parse("2027-01-01T00:00:00Z") / 1000);
    applyStarsPayment(
      { invoice_payload: stale, currency: "XTR", total_amount: 599, telegram_payment_charge_id: "chg_2", is_recurring: true, subscription_expiration_date: exp2 },
      stores as any,
      SECRET,
      { telegramUserId: 42 },
    );
    assert.equal(users[0].plan, "pro");
    assert.equal(users[0].planRenewsAt, exp2 * 1000);
    assert.equal(payments[0].interval, "month");
  });
});
