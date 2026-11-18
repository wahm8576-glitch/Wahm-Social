import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { Users } from "@/lib/server/db";
import { handler } from "@/lib/server/respond";
import { billingMode } from "@/lib/env";
import { paypalFetch } from "@/lib/billing/paypal";

export const POST = handler(async () => {
  const user = await requireUser();
  if (billingMode() === "paypal" && user.paypalSubscriptionId) {
    try {
      await paypalFetch(`/v1/billing/subscriptions/${encodeURIComponent(user.paypalSubscriptionId)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled by customer from Frostly account" }),
      });
    } catch {
      // Still end access at period end locally; webhook will confirm.
    }
  }
  // Keeps access until planRenewsAt; currentUser() downgrades after expiry.
  Users.update(user.id, { planRenewsAt: user.planRenewsAt ?? Date.now() });
  return NextResponse.json({ ok: true, data: { activeUntil: user.planRenewsAt } });
});
