/**
 * Telegram Bot API helpers for Stars payments. The bot token is never logged.
 */
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { PlatformError } from "@/lib/platforms/types";
import { telegramWebhookUrl } from "@/lib/site/publicUrl";
import { STAR_PERIOD_MONTH_SEC, TELEGRAM_BOT_USERNAME_DEFAULT, type PaidInterval, type PaidPlan } from "./stars";

const API = "https://api.telegram.org";
const WEBHOOK_SECRET_INFO = "frostly-tg-webhook";

const g = globalThis as unknown as {
  __frostlyTgUser?: { token: string; username: string };
  __frostlyTgEnsured?: { key: string; url: string };
  __frostlyTgInflight?: Promise<string | undefined>;
};

/** HMAC-SHA256(botToken, "frostly-tg-webhook") as hex, first 48 chars (valid secret_token). */
export function deriveTelegramWebhookSecret(botToken: string): string {
  if (!botToken) return "";
  return crypto.createHmac("sha256", botToken).update(WEBHOOK_SECRET_INFO).digest("hex").slice(0, 48);
}

/** Explicit TELEGRAM_WEBHOOK_SECRET if set, otherwise derived from the bot token. */
export function resolveTelegramWebhookSecret(opts?: { token?: string; explicit?: string }): string {
  const explicit = (opts?.explicit ?? env.telegramWebhookSecret).trim();
  if (explicit) return explicit;
  const token = opts?.token ?? env.telegramBotToken;
  return token ? deriveTelegramWebhookSecret(token) : "";
}

export function webhookSecretMatches(header: string, expected: string): boolean {
  if (!expected || header.length !== expected.length) return false;
  let x = 0;
  for (let i = 0; i < header.length; i++) x |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return x === 0;
}

export function telegramConfigured(): boolean {
  return Boolean(env.telegramBotToken);
}

/** Auth result for /api/telegram/webhook (no I/O). */
export function telegramWebhookGate(header: string): 503 | 401 | 200 {
  const secret = resolveTelegramWebhookSecret();
  if (!telegramConfigured() || !secret) return 503;
  return webhookSecretMatches(header, secret) ? 200 : 401;
}

export function clearTelegramBotCache(): void {
  g.__frostlyTgUser = undefined;
  g.__frostlyTgEnsured = undefined;
}

/** Strip token-shaped substrings so logs never leak credentials. */
export function sanitizeTelegramError(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***")
    .replace(/api\.telegram\.org\/bot[^/\s]+/g, "api.telegram.org/bot***")
    .slice(0, 240);
}

export async function telegramCall<T = unknown>(method: string, body?: Record<string, unknown>, token = env.telegramBotToken): Promise<T> {
  if (!token) throw new PlatformError("internal", "Telegram bot is not configured", 503);
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new PlatformError("upstream_error", json.description ?? `Telegram ${method} failed`, 502);
  return json.result as T;
}

export function invoiceTitle(plan: PaidPlan, interval: PaidInterval): string {
  const name = plan === "pro" ? "Frostly Pro" : "Frostly Business";
  const period = interval === "year" ? "yearly" : "monthly";
  return `${name} ${period}`.slice(0, 32);
}

export function invoiceDescription(plan: PaidPlan, interval: PaidInterval, stars: number): string {
  const name = plan === "pro" ? "فروستلي برو" : "فروستلي أعمال";
  if (interval === "year") return `${name} لمدة سنة واحدة — ${stars} نجمة Telegram (دفعة واحدة).`;
  return `${name} باشتراك شهري يتجدد تلقائياً بـ ${stars} نجمة كل 30 يوماً. يمكن إلغاء التجديد من تيليجرام.`;
}

export async function createStarsInvoiceLink(opts: { title: string; description: string; payload: string; stars: number; interval: PaidInterval }): Promise<string> {
  const body: Record<string, unknown> = {
    title: opts.title,
    description: opts.description.slice(0, 255),
    payload: opts.payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: opts.title, amount: opts.stars }],
  };
  if (opts.interval === "month") body.subscription_period = STAR_PERIOD_MONTH_SEC;
  return telegramCall<string>("createInvoiceLink", body);
}

export async function sendStarsInvoice(opts: { chatId: number; title: string; description: string; payload: string; stars: number; interval: PaidInterval }): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    title: opts.title,
    description: opts.description.slice(0, 255),
    payload: opts.payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: opts.title, amount: opts.stars }],
  };
  if (opts.interval === "month") body.subscription_period = STAR_PERIOD_MONTH_SEC;
  await telegramCall("sendInvoice", body);
}

export async function answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void> {
  const body: Record<string, unknown> = { pre_checkout_query_id: id, ok };
  if (!ok && errorMessage) body.error_message = errorMessage.slice(0, 200);
  await telegramCall("answerPreCheckoutQuery", body);
}

export async function refundStarPayment(telegramUserId: number, telegramPaymentChargeId: string): Promise<void> {
  await telegramCall("refundStarPayment", { user_id: telegramUserId, telegram_payment_charge_id: telegramPaymentChargeId });
}

/** Best-effort: remove the webhook from a previous bot token. Never throws. */
export async function deleteTelegramWebhook(token: string): Promise<void> {
  if (!token) return;
  try {
    await telegramCall("deleteWebhook", { drop_pending_updates: false }, token);
  } catch (e) {
    console.error("[telegram] deleteWebhook failed:", sanitizeTelegramError(e));
  }
}

async function cacheUsernameFromGetMe(token: string): Promise<string> {
  const me = await telegramCall<{ username?: string }>("getMe", undefined, token);
  const name = (me.username || "").replace(/^@/, "");
  if (name) g.__frostlyTgUser = { token, username: name };
  return name || TELEGRAM_BOT_USERNAME_DEFAULT;
}

export async function telegramBotUsername(): Promise<string> {
  const token = env.telegramBotToken;
  if (!token) return TELEGRAM_BOT_USERNAME_DEFAULT;
  if (g.__frostlyTgUser?.token === token && g.__frostlyTgUser.username) return g.__frostlyTgUser.username;
  try {
    return await cacheUsernameFromGetMe(token);
  } catch {
    return TELEGRAM_BOT_USERNAME_DEFAULT;
  }
}

type WebhookInfo = {
  url?: string;
  last_error_date?: number;
  last_error_message?: string;
  pending_update_count?: number;
};

async function setBotProfile(): Promise<void> {
  await telegramCall("setMyCommands", {
    commands: [
      { command: "start", description: "ابدأ واشترك في فروستلي" },
      { command: "terms", description: "شروط الاستخدام" },
      { command: "paysupport", description: "دعم المدفوعات والاسترجاع" },
    ],
    language_code: "ar",
  });
  await telegramCall("setMyCommands", {
    commands: [
      { command: "start", description: "Start and subscribe to Frostly" },
      { command: "terms", description: "Terms of service" },
      { command: "paysupport", description: "Payment and refund support" },
    ],
    language_code: "en",
  });
  await telegramCall("setMyDescription", {
    description: "بوت الدفع لفروستلي. ادفع بنجوم Telegram لاشتراك برو أو أعمال — شهري يتجدد تلقائياً، أو سنوي دفعة واحدة.",
    language_code: "ar",
  });
  await telegramCall("setMyShortDescription", {
    short_description: "ادفع بنجوم Telegram لاشتراك فروستلي برو",
    language_code: "ar",
  });
  await telegramCall("setMyDescription", {
    description: "Frostly payments bot. Pay with Telegram Stars for Pro or Business — monthly auto-renew, or a one-time yearly plan.",
    language_code: "en",
  });
  await telegramCall("setMyShortDescription", {
    short_description: "Pay with Telegram Stars for Frostly Pro",
    language_code: "en",
  });
}

export async function ensureTelegramBot(
  force = false,
  req?: Request | { headers: { get(name: string): string | null } },
): Promise<string | undefined> {
  const token = env.telegramBotToken;
  if (!token) return "skipped: missing token";
  if (g.__frostlyTgUser && g.__frostlyTgUser.token !== token) clearTelegramBotCache();
  const secret = resolveTelegramWebhookSecret();
  if (!secret) return "skipped: missing webhook secret";
  const url = telegramWebhookUrl(req);
  const key = `${token}::${secret}::${url}`;
  if (!force && g.__frostlyTgEnsured?.key === key) return g.__frostlyTgEnsured.url;
  if (g.__frostlyTgInflight && !force) return g.__frostlyTgInflight;

  const run = (async () => {
    try {
      const info = force ? undefined : await telegramCall<WebhookInfo>("getWebhookInfo").catch(() => undefined);
      const needsWebhook = force || !info?.url || info.url !== url;
      if (needsWebhook) {
        await telegramCall("setWebhook", {
          url,
          secret_token: secret,
          allowed_updates: ["message", "pre_checkout_query"],
        });
      }
      const needsProfile = force || !g.__frostlyTgEnsured || g.__frostlyTgEnsured.key.split("::")[0] !== token;
      if (needsProfile) {
        await setBotProfile();
        await cacheUsernameFromGetMe(token).catch(() => TELEGRAM_BOT_USERNAME_DEFAULT);
      }
      g.__frostlyTgEnsured = { key, url };
      return url;
    } finally {
      if (g.__frostlyTgInflight) g.__frostlyTgInflight = undefined;
    }
  })();

  g.__frostlyTgInflight = run;
  return run;
}

/** Fire-and-forget: register or repair the webhook if a token is available. */
export function ensureTelegramBotLazy(req?: Request | { headers: { get(name: string): string | null } }): void {
  if (!env.telegramBotToken) return;
  void ensureTelegramBot(false, req).catch((e) => console.error("[telegram] setup failed:", sanitizeTelegramError(e)));
}

export type TelegramAdminStatus = {
  configured: boolean;
  username?: string;
  webhookUrl?: string;
  expectedUrl?: string;
  lastErrorDate?: number;
  lastErrorMessage?: string;
  pendingUpdateCount?: number;
  error?: string;
};

export async function telegramAdminStatus(req?: Request | { headers: { get(name: string): string | null } }): Promise<TelegramAdminStatus> {
  const expectedUrl = telegramWebhookUrl(req);
  if (!env.telegramBotToken) return { configured: false, expectedUrl };
  try {
    await ensureTelegramBot(false, req);
    const me = await telegramCall<{ username?: string }>("getMe");
    const info = await telegramCall<WebhookInfo>("getWebhookInfo");
    const username = (me.username || "").replace(/^@/, "") || (await telegramBotUsername());
    return {
      configured: true,
      username,
      webhookUrl: info.url || "",
      expectedUrl,
      lastErrorDate: info.last_error_date,
      lastErrorMessage: info.last_error_message ? sanitizeTelegramError(info.last_error_message) : undefined,
      pendingUpdateCount: info.pending_update_count,
    };
  } catch (e) {
    return { configured: true, expectedUrl, error: sanitizeTelegramError(e) };
  }
}
