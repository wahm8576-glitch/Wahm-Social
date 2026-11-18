/** Secret values editable from the admin panel. Stored AES-GCM encrypted, applied onto process.env. */
export interface SecretDef {
  key: string;
  env: string;
  label: string;
  group: "proxy" | "instagram" | "tiktok" | "billing";
  hint?: string;
  multiline?: boolean;
}

export const SECRET_DEFS: SecretDef[] = [
  { key: "scraperProxy", env: "SCRAPER_PROXY", label: "رابط البروكسي SCRAPER_PROXY", group: "proxy", hint: "http://user:pass@host:port (HTTP/HTTPS proxy) — تقدر تحط أكثر من واحد بينهم فاصلة، الأول أساسي والباقي احتياط" },
  { key: "igSessionId", env: "IG_SESSIONID", label: "انستقرام sessionid", group: "instagram" },
  { key: "igCsrfToken", env: "IG_CSRFTOKEN", label: "انستقرام csrftoken", group: "instagram" },
  { key: "igDsUserId", env: "IG_DS_USER_ID", label: "انستقرام ds_user_id", group: "instagram" },
  { key: "igMid", env: "IG_MID", label: "انستقرام mid", group: "instagram" },
  { key: "igDatr", env: "IG_DATR", label: "انستقرام datr", group: "instagram" },
  { key: "tiktokCookie", env: "TIKTOK_COOKIE", label: "تيك توك Cookie كامل", group: "tiktok", multiline: true, hint: "سطر الكوكيز كامل من متصفح مسجّل دخول" },
  { key: "tiktokSessionId", env: "TIKTOK_SESSIONID", label: "تيك توك sessionid", group: "tiktok" },
  { key: "tiktokClientKey", env: "TIKTOK_CLIENT_KEY", label: "TikTok Client Key", group: "tiktok" },
  { key: "tiktokClientSecret", env: "TIKTOK_CLIENT_SECRET", label: "TikTok Client Secret", group: "tiktok" },
  { key: "stripeSecretKey", env: "STRIPE_SECRET_KEY", label: "Stripe Secret Key", group: "billing" },
  { key: "stripeWebhookSecret", env: "STRIPE_WEBHOOK_SECRET", label: "Stripe Webhook Secret", group: "billing" },
  { key: "paypalClientId", env: "PAYPAL_CLIENT_ID", label: "PayPal Client ID", group: "billing" },
  { key: "paypalClientSecret", env: "PAYPAL_CLIENT_SECRET", label: "PayPal Client Secret", group: "billing" },
  { key: "paypalWebhookId", env: "PAYPAL_WEBHOOK_ID", label: "PayPal Webhook ID", group: "billing" },
  { key: "paypalEnv", env: "PAYPAL_ENV", label: "PayPal environment (sandbox أو live)", group: "billing", hint: "sandbox للاختبار، live للإنتاج" },
  { key: "paypalPlanProMonthly", env: "PAYPAL_PLAN_PRO_MONTHLY", label: "PayPal plan id — Pro شهري", group: "billing" },
  { key: "paypalPlanProYearly", env: "PAYPAL_PLAN_PRO_YEARLY", label: "PayPal plan id — Pro سنوي", group: "billing" },
  { key: "paypalPlanBizMonthly", env: "PAYPAL_PLAN_BIZ_MONTHLY", label: "PayPal plan id — Business شهري", group: "billing" },
  { key: "paypalPlanBizYearly", env: "PAYPAL_PLAN_BIZ_YEARLY", label: "PayPal plan id — Business سنوي", group: "billing" },
];

export const SECRET_KEYS = new Set(SECRET_DEFS.map((d) => d.key));

/** Secrets bag: panel-set values plus the admin password hash (if changed from the panel). */
export type Secrets = Record<string, string>;

/** Masked description — never returns the value itself. */
export function maskSecret(v: string | undefined): string {
  if (!v) return "غير مضبوط";
  return `مضبوط •••• (${v.length} حرف)`;
}
