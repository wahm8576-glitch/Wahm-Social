/**
 * Centralised, typed access to environment variables.
 * Secrets are never exposed to the client — only NEXT_PUBLIC_* are.
 *
 * Every field is a getter so values edited in the admin panel (applied onto
 * process.env at runtime, see lib/site/apply.ts) take effect without a redeploy.
 */
import { igSessionToken } from "./platforms/instagram/session/cookie-env";

function read(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const env = {
  get siteUrl() {
    return read("SITE_URL", read("NEXT_PUBLIC_SITE_URL", read("RENDER_EXTERNAL_URL", "http://localhost:3000"))).replace(/\/$/, "");
  },
  get jwtSecret() {
    return read("JWT_SECRET", "wahm-dev-secret-change-me-please-0123456789");
  },
  get adminEmails() {
    return read("ADMIN_EMAILS")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  get igSessionId() {
    // Accept a bare token or a pasted cookie header; always return the sessionid token only.
    return igSessionToken(read("IG_SESSIONID"));
  },
  get igCsrfToken() {
    return read("IG_CSRFTOKEN");
  },
  get igDsUserId() {
    return read("IG_DS_USER_ID");
  },
  get igMid() {
    return read("IG_MID");
  },
  get igDatr() {
    return read("IG_DATR");
  },
  get scraperProxy() {
    return read("SCRAPER_PROXY");
  },
  /** Optional Cloudflare Worker relay for tiktok.com / tikwm.com / countik.com (not a secret). */
  get relayUrl() {
    return read("RELAY_URL");
  },
  /** Optional TikTok web session cookie (sessionid) for list endpoints. */
  get tiktokSessionId() {
    return read("TIKTOK_SESSIONID");
  },
  /** Full TikTok Cookie header from a logged-in browser (msToken, ttwid, tt_csrf_token, …). Never logged. */
  get tiktokCookie() {
    return read("TIKTOK_COOKIE");
  },
  get stripeSecret() {
    return read("STRIPE_SECRET_KEY");
  },
  get stripePriceMonthly() {
    return read("STRIPE_PRICE_PRO_MONTHLY");
  },
  get stripePriceYearly() {
    return read("STRIPE_PRICE_PRO_YEARLY");
  },
  get stripeWebhookSecret() {
    return read("STRIPE_WEBHOOK_SECRET");
  },
  get paypalClientId() {
    return read("PAYPAL_CLIENT_ID");
  },
  get paypalClientSecret() {
    return read("PAYPAL_CLIENT_SECRET");
  },
  get paypalWebhookId() {
    return read("PAYPAL_WEBHOOK_ID");
  },
  get paypalEnv() {
    const v = read("PAYPAL_ENV", "sandbox").toLowerCase();
    return v === "live" || v === "production" ? "live" : "sandbox";
  },
  get paypalPlanProMonthly() {
    return read("PAYPAL_PLAN_PRO_MONTHLY");
  },
  get paypalPlanProYearly() {
    return read("PAYPAL_PLAN_PRO_YEARLY");
  },
  get paypalPlanBizMonthly() {
    return read("PAYPAL_PLAN_BIZ_MONTHLY");
  },
  get paypalPlanBizYearly() {
    return read("PAYPAL_PLAN_BIZ_YEARLY");
  },
  get telegramBotToken() {
    return read("TELEGRAM_BOT_TOKEN");
  },
  get telegramWebhookSecret() {
    return read("TELEGRAM_WEBHOOK_SECRET");
  },
  get telegramBotUsername() {
    return read("TELEGRAM_BOT_USERNAME", "PaySubStarsBot");
  },
  get demoMode() {
    return read("DEMO_MODE", "auto") as "auto" | "on" | "off";
  },
  get dataDir() {
    return read("DATA_DIR", "./data");
  },
  /** Brevo transactional API key (server only). Never log this value. */
  get brevoApiKey() {
    return read("BREVO_API_KEY");
  },
  get brevoSenderEmail() {
    return read("BREVO_SENDER_EMAIL");
  },
  get brevoSenderName() {
    return read("BREVO_SENDER_NAME", "Frostly | فروستلي");
  },
  /** True on Render (all plans). Outbound SMTP is blocked on the free instance. */
  get onRender() {
    return Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
};


export type BillingMode = "paypal" | "stripe" | "mock" | "off";

export const paypalConfigured = () => Boolean(env.paypalClientId && env.paypalClientSecret);

export const telegramStarsConfigured = () => Boolean(env.telegramBotToken);

/** paypal if credentials exist; else stripe; mock only in local/dev; off in production when nothing is configured. */
export const billingMode = (): BillingMode => {
  if (paypalConfigured()) return "paypal";
  if (env.stripeSecret) return "stripe";
  if (env.isProd) return "off";
  return "mock";
};

/** Official TikTok Research API credentials (https://developers.tiktok.com/products/research-api/). */
export const tiktokResearch = {
  get clientKey() {
    return process.env.TIKTOK_CLIENT_KEY ?? "";
  },
  get clientSecret() {
    return process.env.TIKTOK_CLIENT_SECRET ?? "";
  },
  get enabled() {
    return Boolean(this.clientKey && this.clientSecret);
  },
};
