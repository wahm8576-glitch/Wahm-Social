/**
 * Creates a Telegram Stars invoice link for the signed-in user.
 * Monthly plans use a Stars subscription (30-day period); yearly is a one-time payment.
 * Falls back to a t.me/<bot>?start= deep link if createInvoiceLink fails.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/server/auth";
import { handler } from "@/lib/server/respond";
import { PlatformError } from "@/lib/platforms/types";
import { requireFeatureOn } from "@/lib/site/flags";
import { getSettings } from "@/lib/site/store";
import {
  deepLink,
  effectiveStarPrices,
  newStarPayload,
  signStarPayload,
  starPriceKey,
} from "@/lib/billing/stars";
import { createStarsInvoiceLink, invoiceDescription, invoiceTitle, telegramBotUsername, telegramConfigured, sanitizeTelegramError } from "@/lib/billing/telegram";

const Body = z.object({ plan: z.enum(["pro", "business"]), interval: z.enum(["month", "year"]) });

export const POST = handler(async (req: Request) => {
  requireFeatureOn("pro");
  if (!telegramConfigured()) throw new PlatformError("internal", "Telegram Stars are not configured", 503);
  const user = await requireUser();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new PlatformError("invalid_input", "Invalid plan", 400);
  const { plan, interval } = parsed.data;
  const settings = await getSettings();
  const stars = effectiveStarPrices(settings.features.starPrices, settings.features.prices)[starPriceKey(plan, interval)];
  const payload = signStarPayload(newStarPayload({ userId: user.id, plan, interval, stars }), env.jwtSecret);
  const fallback = deepLink(telegramBotUsername(), payload);
  try {
    const link = await createStarsInvoiceLink({
      title: invoiceTitle(plan, interval),
      description: invoiceDescription(plan, interval, stars),
      payload,
      stars,
      interval,
    });
    return NextResponse.json({ ok: true, data: { mode: "telegram_stars", redirect: link, fallback, stars, interval } });
  } catch (e) {
    console.error("[telegram] createInvoiceLink failed:", sanitizeTelegramError(e));
    return NextResponse.json({ ok: true, data: { mode: "telegram_stars", redirect: fallback, fallback, stars, interval } });
  }
});
