/** Telegram Stars price helpers (safe to import from client components). */
export type PaidPlan = "pro" | "business";
export type PaidInterval = "month" | "year";
export type StarPriceKey = "proMonthly" | "proYearly" | "bizMonthly" | "bizYearly";
export type StarPrices = Record<StarPriceKey, number>;

export const STAR_PERIOD_MONTH_SEC = 2_592_000;
export const STAR_PAYLOAD_TTL_SEC = 30 * 60;
export const TELEGRAM_BOT_USERNAME_DEFAULT = "PaySubStarsBot";

/** ~ USD × 77, rounded to a friendly Stars amount (x0 below 200, otherwise x99). */
export function niceStarPrice(usd: number): number {
  const raw = usd * 77;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  if (raw < 200) return Math.max(1, Math.round(raw / 10) * 10);
  return Math.max(1, Math.round(raw / 100) * 100 - 1);
}

export const DEFAULT_STAR_PRICES: StarPrices = {
  proMonthly: niceStarPrice(7.99),
  proYearly: niceStarPrice(59.99),
  bizMonthly: niceStarPrice(29.99),
  bizYearly: niceStarPrice(249.99),
};

export function starPriceKey(plan: PaidPlan, interval: PaidInterval): StarPriceKey {
  if (plan === "pro") return interval === "year" ? "proYearly" : "proMonthly";
  return interval === "year" ? "bizYearly" : "bizMonthly";
}

export function effectiveStarPrices(overrides?: Partial<StarPrices> | null, usd?: Partial<StarPrices> | null): StarPrices {
  const out = { ...DEFAULT_STAR_PRICES };
  if (usd) {
    for (const k of Object.keys(out) as StarPriceKey[]) {
      const n = usd[k];
      if (typeof n === "number" && n > 0) out[k] = niceStarPrice(n);
    }
  }
  if (overrides) {
    for (const k of Object.keys(out) as StarPriceKey[]) {
      const n = overrides[k];
      if (typeof n === "number" && n > 0) out[k] = Math.round(n);
    }
  }
  return out;
}
