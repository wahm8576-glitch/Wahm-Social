/**
 * Lazy migration: the browser's Firebase sign-in failed, so check the legacy site password.
 * If it matches and Firebase has no user with that email, create the Firebase user with the same password.
 * The browser then retries the Firebase sign-in. Never overwrites an existing Firebase user.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/auth";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { createFirebaseUser, firebaseUserByEmail } from "@/lib/firebase/admin";
import { logError } from "@/lib/server/errorLog";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const NO = { ok: true, data: { migrated: false } };

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  await getSettings();
  if (!firebaseEnabled()) return NextResponse.json(NO);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json(NO);
  const email = parsed.data.email.toLowerCase();
  if (!rateLimit(`fbmig-ip:${clientIp(req)}`, 10, 15 * 60_000).allowed || !rateLimit(`fbmig-email:${email}`, 5, 15 * 60_000).allowed) {
    return NextResponse.json({ ok: false, error: { code: "rate_limited", message: "محاولات كثيرة، جرّب بعد شوي. Too many attempts." } }, { status: 429 });
  }
  const user = Users.byEmail(email);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return NextResponse.json(NO);
  try {
    if (await firebaseUserByEmail(email)) return NextResponse.json(NO);
    if (parsed.data.password.length < 6) return NextResponse.json(NO);
    await createFirebaseUser({ email, password: parsed.data.password, displayName: user.name });
    return NextResponse.json({ ok: true, data: { migrated: true } });
  } catch (e) {
    logError("api", `firebase migrate failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return NextResponse.json(NO);
  }
});
