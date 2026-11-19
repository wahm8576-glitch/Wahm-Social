import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  deriveTelegramWebhookSecret,
  resolveTelegramWebhookSecret,
  telegramWebhookGate,
  webhookSecretMatches,
  clearTelegramBotCache,
} from "../src/lib/billing/telegram";

const TOKEN = "123456789:TESTTOKEN_for_unit_tests_only";

describe("telegram webhook secret derivation", () => {
  test("HMAC-SHA256(botToken, frostly-tg-webhook) hex first 48 chars", () => {
    const expected = crypto.createHmac("sha256", TOKEN).update("frostly-tg-webhook").digest("hex").slice(0, 48);
    assert.equal(deriveTelegramWebhookSecret(TOKEN), expected);
    assert.equal(expected.length, 48);
    assert.match(expected, /^[0-9a-f]{48}$/);
    assert.equal(deriveTelegramWebhookSecret(""), "");
    assert.notEqual(deriveTelegramWebhookSecret(TOKEN), deriveTelegramWebhookSecret(TOKEN + "x"));
  });

  test("explicit secret overrides the derived value", () => {
    assert.equal(resolveTelegramWebhookSecret({ token: TOKEN, explicit: "" }), deriveTelegramWebhookSecret(TOKEN));
    assert.equal(resolveTelegramWebhookSecret({ token: TOKEN, explicit: "custom-secret" }), "custom-secret");
  });

  test("timing-safe compare rejects a wrong or empty secret", () => {
    const ok = deriveTelegramWebhookSecret(TOKEN);
    assert.equal(webhookSecretMatches(ok, ok), true);
    assert.equal(webhookSecretMatches("0".repeat(48), ok), false);
    assert.equal(webhookSecretMatches(ok.slice(0, 47), ok), false);
    assert.equal(webhookSecretMatches(ok, ""), false);
  });
});

describe("telegram webhook gate", () => {
  let prevToken: string | undefined;
  let prevSecret: string | undefined;

  before(() => {
    prevToken = process.env.TELEGRAM_BOT_TOKEN;
    prevSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  after(() => {
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = prevSecret;
    clearTelegramBotCache();
  });

  test("503 without a token, 200/401 once a token can derive the secret", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const derived = deriveTelegramWebhookSecret(TOKEN);
    assert.equal(telegramWebhookGate(derived), 503);
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    assert.equal(telegramWebhookGate(derived), 200);
    assert.equal(telegramWebhookGate("deadbeef".padEnd(48, "0")), 401);
    assert.equal(telegramWebhookGate(""), 401);
  });
});
