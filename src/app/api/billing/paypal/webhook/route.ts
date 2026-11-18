/**
 * PayPal webhook. Verifies transmission headers via PayPal's verify API, then
 * applies subscription and payment events. Idempotent by event id.
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { BillingEvents, Payments, Users, type User } from "@/lib/server/db";
import { applyPaypalEvent, readPaypalWebhookHeaders, verifyPaypalWebhook, type BillingUser } from "@/lib/billing/paypal";

export const dynamic = "force-dynamic";

function stores() {
  return {
    findUser(q: { id?: string; email?: string; subscriptionId?: string }): BillingUser | undefined {
      const u: User | undefined = q.id
        ? Users.byId(q.id)
        : q.email
          ? Users.byEmail(q.email)
          : q.subscriptionId
            ? Users.all().find((x) => x.paypalSubscriptionId === q.subscriptionId)
            : undefined;
      return u;
    },
    updateUser(id: string, patch: Partial<BillingUser> & { plan: User["plan"] }) {
      Users.update(id, patch);
    },
    addPayment(p: Parameters<typeof Payments.create>[0]) {
      Payments.create(p);
    },
    seenEvent(id: string) {
      return BillingEvents.has(id);
    },
    markEvent(id: string, type: string) {
      BillingEvents.add(id, type);
    },
  };
}

export async function POST(req: Request) {
  const payload = await req.text();
  const headers = readPaypalWebhookHeaders(req.headers);
  if (!env.paypalWebhookId || !headers || !(await verifyPaypalWebhook(payload, headers))) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  applyPaypalEvent(event, stores());
  return NextResponse.json({ ok: true });
}
