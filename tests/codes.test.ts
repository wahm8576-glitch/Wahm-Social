import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  applyCodeToPlan,
  applyRedeemToState,
  batchStats,
  codeLast4,
  CODE_ENTROPY_BITS,
  encodeCrockfordBits,
  generateActivationCode,
  GENERIC_REDEEM_ERROR,
  hashActivationCode,
  normalizeActivationCode,
  recordRedeemAttempt,
  redeemRateState,
  REDEEM_LOCK_MS,
  REDEEM_MAX_ATTEMPTS,
  resetRedeemRateForTests,
  type ActivationBatch,
  type ActivationCode,
} from "../src/lib/billing/codes";

const SECRET = "test-code-secret";

function codeRecord(partial: Partial<ActivationCode> & { hash: string }): ActivationCode {
  return {
    id: partial.id ?? "ac_1",
    batchId: partial.batchId ?? "ab_1",
    hash: partial.hash,
    last4: partial.last4 ?? "ZZZZ",
    plan: partial.plan ?? "pro",
    days: partial.days ?? 30,
    maxUses: partial.maxUses ?? 1,
    uses: partial.uses ?? 0,
    expiresAt: partial.expiresAt,
    disabled: partial.disabled,
    label: partial.label ?? "gift",
    redemptions: partial.redemptions ?? [],
  };
}

describe("activation code format and entropy", () => {
  test("FROST-XXXX-XXXX-XXXX-XXXX uses Crockford base32 and 80 bits", () => {
    const samples = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const code = generateActivationCode();
      assert.match(code, /^FROST-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      const body = code.replace(/^FROST-/, "").replace(/-/g, "");
      assert.doesNotMatch(body, /[ILOU]/);
      samples.add(code);
    }
    assert.equal(samples.size, 40);
    const body = encodeCrockfordBits(crypto.randomBytes(10), CODE_ENTROPY_BITS);
    assert.equal(body.length, 16);
    assert.equal(CODE_ENTROPY_BITS, 16 * 5);
  });

  test("normalize accepts lowercase, dashes, and ambiguous characters", () => {
    const code = generateActivationCode();
    const lower = code.toLowerCase().replace(/-/g, " ");
    assert.equal(normalizeActivationCode(lower), code);
    assert.equal(normalizeActivationCode("frost-01il-ouaa-bbbb-cccc")?.includes("FROST-"), true);
    // I,L → 1; O → 0; U → V
    const n = normalizeActivationCode("frost-01il-ouaa-bbbb-cccc");
    assert.equal(n, "FROST-0111-0VAA-BBBB-CCCC");
    assert.equal(normalizeActivationCode("nope"), null);
    assert.equal(normalizeActivationCode("FROST-SHORT"), null);
    assert.equal(codeLast4(code), code.slice(-4));
  });

  test("hash is HMAC-SHA256 of the canonical code and hides the plaintext", () => {
    const code = generateActivationCode();
    const h = hashActivationCode(code, SECRET);
    assert.equal(h, crypto.createHmac("sha256", SECRET).update(code).digest("hex"));
    assert.equal(h.length, 64);
    assert.ok(!h.includes(code));
    assert.notEqual(hashActivationCode(code, SECRET), hashActivationCode(code, "other"));
    assert.equal(hashActivationCode(code.toLowerCase(), SECRET), h);
  });
});

describe("redemption plan math and atomic double-use", () => {
  const now = Date.parse("2026-11-19T04:00:00+03:00");

  test("upgrade starts from now; same plan extends current expiry", () => {
    const up = applyCodeToPlan({ codePlan: "pro", days: 30, currentPlan: "free", now });
    assert.equal(up.plan, "pro");
    assert.equal(up.planRenewsAt, now + 30 * 864e5);
    assert.equal(up.extended, false);
    const future = now + 10 * 864e5;
    const ext = applyCodeToPlan({ codePlan: "pro", days: 30, currentPlan: "pro", planRenewsAt: future, now });
    assert.equal(ext.plan, "pro");
    assert.equal(ext.planRenewsAt, future + 30 * 864e5);
    assert.equal(ext.extended, true);
    const biz = applyCodeToPlan({ codePlan: "business", days: 365, currentPlan: "pro", planRenewsAt: future, now });
    assert.equal(biz.plan, "business");
    assert.equal(biz.planRenewsAt, now + 365 * 864e5);
    assert.equal(biz.extended, false);
    // do not downgrade an active higher plan
    const keep = applyCodeToPlan({ codePlan: "pro", days: 30, currentPlan: "business", planRenewsAt: future, now });
    assert.equal(keep.plan, "business");
    assert.equal(keep.planRenewsAt, future + 30 * 864e5);
  });

  test("second redeem of a single-use code is rejected and does not change the user twice", () => {
    const code = generateActivationCode();
    const hash = hashActivationCode(code, SECRET);
    const rec = codeRecord({ hash, last4: codeLast4(code), maxUses: 1, uses: 0 });
    const batch: ActivationBatch = {
      id: "ab_1",
      createdAt: now,
      label: "gift",
      plan: "pro",
      durationKind: "month",
      days: 30,
      maxUses: 1,
      total: 1,
    };
    const users = [{ id: "u_1", email: "a@x.com", plan: "free" as const, planRenewsAt: undefined as number | undefined }];
    const state = { codes: [rec], batches: [batch], users, payments: [] };
    const first = applyRedeemToState(state, { hash, user: users[0], now, paymentId: "pay_1" });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.plan, "pro");
      assert.equal(first.payment.provider, "code");
      assert.equal(first.payment.batchLabel, "gift");
      assert.equal(first.payment.amount, 0);
    }
    assert.equal(users[0].plan, "pro");
    const expiry = users[0].planRenewsAt;
    const second = applyRedeemToState(state, { hash, user: users[0], now: now + 1000, paymentId: "pay_2" });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, "used");
    assert.equal(rec.uses, 1);
    assert.equal(state.payments.length, 1);
    assert.equal(users[0].planRenewsAt, expiry);
  });

  test("same user cannot redeem a multi-use code twice; another user can", () => {
    const hash = hashActivationCode(generateActivationCode(), SECRET);
    const rec = codeRecord({ hash, maxUses: 2, uses: 0, plan: "business", days: 365 });
    const batch: ActivationBatch = {
      id: "ab_1",
      createdAt: now,
      label: "",
      plan: "business",
      durationKind: "year",
      days: 365,
      maxUses: 2,
      total: 1,
    };
    const u1 = { id: "u_1", email: "a@x.com", plan: "free" as const };
    const u2 = { id: "u_2", email: "b@x.com", plan: "free" as const };
    const state = { codes: [rec], batches: [batch], users: [u1, u2], payments: [] };
    assert.equal(applyRedeemToState(state, { hash, user: u1, now, paymentId: "p1" }).ok, true);
    const again = applyRedeemToState(state, { hash, user: u1, now, paymentId: "p2" });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.reason, "already");
    assert.equal(applyRedeemToState(state, { hash, user: u2, now, paymentId: "p3" }).ok, true);
    assert.equal(rec.uses, 2);
    assert.equal(u2.plan, "business");
    const third = applyRedeemToState(state, { hash, user: { id: "u_3", email: "c@x.com", plan: "free" }, now, paymentId: "p4" });
    assert.equal(third.ok, false);
  });

  test("expired, disabled, and unknown hashes are rejected", () => {
    const rec = codeRecord({ hash: "dead", expiresAt: now - 1 });
    const batch: ActivationBatch = { id: "ab_1", createdAt: 0, label: "", plan: "pro", durationKind: "month", days: 30, maxUses: 1, total: 1 };
    const users = [{ id: "u_1", email: "a@x.com", plan: "free" as const }];
    const expired = applyRedeemToState({ codes: [rec], batches: [batch], users, payments: [] }, { hash: "dead", user: users[0], now, paymentId: "p" });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, "expired");
    rec.expiresAt = now + 864e5;
    rec.disabled = true;
    const disabled = applyRedeemToState({ codes: [rec], batches: [batch], users, payments: [] }, { hash: "dead", user: users[0], now, paymentId: "p" });
    assert.equal(disabled.ok, false);
    const missing = applyRedeemToState({ codes: [], batches: [batch], users, payments: [] }, { hash: "nope", user: users[0], now, paymentId: "p" });
    assert.equal(missing.ok, false);
  });

  test("batchStats counts used, unused, expired, disabled", () => {
    const codes = [
      codeRecord({ hash: "a", uses: 0, last4: "AAAA" }),
      codeRecord({ hash: "b", uses: 1, maxUses: 1, last4: "BBBB" }),
      codeRecord({ hash: "c", uses: 0, expiresAt: 1, last4: "CCCC" }),
      codeRecord({ hash: "d", uses: 0, disabled: true, last4: "DDDD" }),
    ];
    const s = batchStats(codes, false, 100);
    assert.deepEqual(s, { total: 4, used: 1, unused: 1, expired: 1, disabled: 1 });
  });
});

describe("redeem rate limit", () => {
  beforeEach(() => resetRedeemRateForTests());

  test("5 attempts in 10 minutes then a 1 hour lock", () => {
    const t0 = Date.parse("2026-11-19T04:00:00+03:00");
    for (let i = 0; i < REDEEM_MAX_ATTEMPTS; i++) {
      const r = recordRedeemAttempt("u1", t0 + i * 1000);
      if (i < REDEEM_MAX_ATTEMPTS - 1) assert.equal(r.allowed, true);
    }
    const locked = redeemRateState("u1", t0 + 9_000);
    assert.equal(locked.allowed, false);
    assert.equal(locked.lockedUntil, t0 + (REDEEM_MAX_ATTEMPTS - 1) * 1000 + REDEEM_LOCK_MS);
    // still locked 59 minutes later
    assert.equal(redeemRateState("u1", locked.lockedUntil! - 1).allowed, false);
    assert.equal(redeemRateState("u1", locked.lockedUntil!).allowed, true);
    assert.equal(GENERIC_REDEEM_ERROR.ar.includes("تعذر"), true);
  });
});
