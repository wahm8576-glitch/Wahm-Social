/** Pure helpers for the admin plan grant/revoke tool (unit-tested). */
import type { PlanId } from "@/lib/plans";

export type GrantDuration = "month" | "year" | "days" | "until";

export interface GrantInput {
  plan: PlanId;
  duration: GrantDuration;
  days?: number;
  /** Calendar date `YYYY-MM-DD`, interpreted as end of that day in Asia/Riyadh (UTC+3). */
  until?: string;
  /** If true and the user already has a future expiry, add the duration on top of it. */
  extend?: boolean;
}

export class GrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantError";
  }
}

const DAY = 86_400_000;
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** End of the given calendar date in Asia/Riyadh (23:59:59.999 UTC+3). */
export function endOfDayRiyadh(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) throw new GrantError("تاريخ غير صالح — استخدم YYYY-MM-DD");
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - RIYADH_OFFSET_MS;
  const check = new Date(utc + RIYADH_OFFSET_MS);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) {
    throw new GrantError("تاريخ غير صالح");
  }
  return utc;
}

export function computeRenewsAt(input: GrantInput, now = Date.now(), existingRenewsAt?: number): number | undefined {
  if (input.plan === "free") return undefined;
  const start = input.extend && existingRenewsAt && existingRenewsAt > now ? existingRenewsAt : now;
  if (input.duration === "month") return start + 30 * DAY;
  if (input.duration === "year") return start + 365 * DAY;
  if (input.duration === "days") {
    const n = Number(input.days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) throw new GrantError("عدد الأيام لازم يكون بين 1 و 3650");
    return start + n * DAY;
  }
  if (input.duration === "until") {
    if (!input.until) throw new GrantError("حدد تاريخ الانتهاء");
    const at = endOfDayRiyadh(input.until);
    if (at <= now) throw new GrantError("تاريخ الانتهاء لازم يكون في المستقبل");
    return at;
  }
  throw new GrantError("مدة غير صالحة");
}

export type PaymentInterval = "month" | "year" | "custom";

export function grantPatch(
  input: GrantInput,
  now = Date.now(),
  existing: { plan?: PlanId; planRenewsAt?: number; userId: string } = { userId: "" },
): { plan: PlanId; planRenewsAt?: number; interval: PaymentInterval } {
  if (input.plan !== "free" && input.plan !== "pro" && input.plan !== "business") {
    throw new GrantError("خطة غير صالحة");
  }
  if (input.plan === "free") {
    return { plan: "free", planRenewsAt: undefined, interval: "custom" };
  }
  const extend = Boolean(input.extend && existing.plan && existing.plan !== "free");
  const planRenewsAt = computeRenewsAt({ ...input, extend }, now, existing.planRenewsAt);
  const interval: PaymentInterval = input.duration === "year" ? "year" : input.duration === "month" ? "month" : "custom";
  return { plan: input.plan, planRenewsAt, interval };
}
