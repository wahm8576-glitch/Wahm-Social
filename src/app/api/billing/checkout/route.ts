/**
 * Starts a Pro/Business subscription.
 *  - paypal: creates a PayPal Subscription and returns the approval URL.
 *  - stripe: creates a Stripe Checkout Session via REST and returns its URL.
 *  - mock: upgrades immediately — only in local/dev (never in production).
 *  - off: payments are not configured yet.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { env, billingMode } from "@/lib/env";
import { PLANS } from "@/lib/plans";
import { Payments, Users } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { handler } from "@/lib/server/respond";
import { PlatformError } from "@/lib/platforms/types";
import { requireFeatureOn } from "@/lib/site/flags";
import { paypalFetch, paypalPlanId } from "@/lib/billing/paypal";
import { billingReturnUrls } from "@/lib/site/publicUrl";

const Body = z.object({ plan: z.enum(["pro", "business"]), interval: z.enum(["month", "year"]) });

export const POST = handler(async (req: Request) => {
  requireFeatureOn("pro");
  const user = await requireUser();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new PlatformError("invalid_input", "Invalid plan", 400);
  const { plan, interval } = parsed.data;
  const p = PLANS[plan];
  const amount = interval === "year" ? p.priceYearly : p.priceMonthly;
  const mode = billingMode();

  if (mode === "off") {
    throw new PlatformError("internal", "Payments are not configured yet", 503);
  }

  if (mode === "mock") {
    const renews = Date.now() + (interval === "year" ? 365 : 30) * 864e5;
    Users.update(user.id, { plan, planRenewsAt: renews });
    Payments.create({ userId: user.id, plan, interval, amount, currency: "USD", provider: "mock", status: "paid" });
    return NextResponse.json({ ok: true, data: { mode: "mock", redirect: "/account?upgraded=1" } });
  }

  const returns = billingReturnUrls(req);

  if (mode === "paypal") {
    const planId = paypalPlanId(plan, interval);
    if (!planId) throw new PlatformError("internal", "PayPal plan ids are not configured", 500);
    const given = (user.name || "").trim().split(/\s+/)[0] || undefined;
    const surname = (user.name || "").trim().split(/\s+/).slice(1).join(" ") || undefined;
    const json = await paypalFetch<{ links?: { rel: string; href: string }[] }>("/v1/billing/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        plan_id: planId,
        custom_id: user.id,
        subscriber: {
          email_address: user.email,
          ...(given ? { name: { given_name: given.slice(0, 140), surname: (surname || given).slice(0, 140) } } : {}),
        },
        application_context: {
          brand_name: "Frostly",
          locale: "en-US",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          return_url: returns.returnUrl,
          cancel_url: returns.cancelUrl,
        },
      }),
    });
    const approve = json.links?.find((l) => l.rel === "approve")?.href;
    if (!approve) throw new PlatformError("upstream_error", "PayPal did not return an approval URL", 502);
    return NextResponse.json({ ok: true, data: { mode: "paypal", redirect: approve } });
  }

  const price = interval === "year" ? env.stripePriceYearly : env.stripePriceMonthly;
  if (!price) throw new PlatformError("internal", "Stripe price ids are not configured", 500);
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: returns.returnUrl,
    cancel_url: returns.cancelUrl,
    client_reference_id: user.id,
    customer_email: user.email,
    "metadata[plan]": plan,
    "metadata[interval]": interval,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.stripeSecret}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const json = (await res.json()) as { url?: string; error?: { message: string } };
  if (!res.ok || !json.url) throw new PlatformError("upstream_error", json.error?.message ?? "Stripe error", 502);
  return NextResponse.json({ ok: true, data: { mode: "stripe", redirect: json.url } });
});
