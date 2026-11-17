/**
 * Before the browser asks Firebase to email a reset link: if the email belongs to a legacy site account
 * that has no Firebase user yet, create one (no password) so Firebase can send the link.
 * Always answers the same way — never reveals whether the email is registered.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { createFirebaseUser, firebaseUserByEmail } from "@/lib/firebase/admin";
import { logError } from "@/lib/server/errorLog";

const Body = z.object({ email: z.string().email().max(200) });
const OK = { ok: true, data: { ready: true } };

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  await getSettings();
  if (!firebaseEnabled()) return NextResponse.json(OK);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json(OK);
  const email = parsed.data.email.toLowerCase();
  if (!rateLimit(`fbreset-ip:${clientIp(req)}`, 5, 15 * 60_000).allowed) {
    return NextResponse.json({ ok: false, error: { code: "rate_limited", message: "محاولات كثيرة، جرّب بعد شوي. Too many requests, try again later." } }, { status: 429 });
  }
  if (!rateLimit(`fbreset-email:${email}`, 3, 60 * 60_000).allowed) return NextResponse.json(OK);
  const user = Users.byEmail(email);
  if (user) {
    try {
      if (!(await firebaseUserByEmail(email))) await createFirebaseUser({ email, displayName: user.name });
    } catch (e) {
      logError("api", `firebase prepare-reset failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }
  return NextResponse.json(OK);
});
