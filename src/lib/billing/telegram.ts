/**
 * Telegram Bot API helpers for Stars payments. The bot token is never logged.
 */
import { env } from "@/lib/env";
import { PlatformError } from "@/lib/platforms/types";
import { STAR_PERIOD_MONTH_SEC, TELEGRAM_BOT_USERNAME_DEFAULT, type PaidInterval, type PaidPlan } from "./stars";

const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(env.telegramBotToken);
}

export function telegramBotUsername(): string {
  return (env.telegramBotUsername || TELEGRAM_BOT_USERNAME_DEFAULT).replace(/^@/, "");
}

/** Strip token-shaped substrings so logs never leak credentials. */
export function sanitizeTelegramError(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***")
    .replace(/api\.telegram\.org\/bot[^/\s]+/g, "api.telegram.org/bot***")
    .slice(0, 240);
}

export async function telegramCall<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = env.telegramBotToken;
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

export async function ensureTelegramBot(): Promise<string | undefined> {
  if (!env.telegramBotToken || !env.telegramWebhookSecret) return "skipped: missing token or webhook secret";
  const url = `${env.siteUrl}/api/telegram/webhook`;
  await telegramCall("setWebhook", {
    url,
    secret_token: env.telegramWebhookSecret,
    allowed_updates: ["message", "pre_checkout_query"],
  });
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
  return url;
}
