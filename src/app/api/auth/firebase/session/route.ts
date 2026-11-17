/** Exchange a Firebase ID token for the site's own session cookie (plans, admin emails, billing keep working). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { publicUser, sessionCookie, signSession } from "@/lib/server/auth";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { PlatformError } from "@/lib/platforms/types";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { verifyFirebaseToken } from "@/lib/firebase/admin";
import { userForFirebase } from "@/lib/firebase/users";

const Body = z.object({ idToken: z.string().min(100).max(5000), name: z.string().max(60).optional() });

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 20);
  await getSettings();
  if (!firebaseEnabled()) throw new PlatformError("not_found", "Firebase auth is not enabled", 404);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new PlatformError("invalid_input", "Invalid sign-in token", 400);
  let decoded;
  try {
    decoded = await verifyFirebaseToken(parsed.data.idToken);
  } catch {
    throw new PlatformError("unauthorized", "انتهت صلاحية تسجيل الدخول، حاول مرة ثانية. Sign-in expired, try again.", 401);
  }
  if (!decoded.email) throw new PlatformError("invalid_input", "الحساب ما فيه بريد إلكتروني. This account has no email.", 400);
  // Google accounts are verified by Google; email/password accounts may sign in before verifying (same as before).
  const user = await userForFirebase(decoded.email, parsed.data.name || (decoded.name as string | undefined));
  const res = NextResponse.json({ ok: true, data: publicUser(user) });
  res.cookies.set(sessionCookie(await signSession(user.id)));
  return res;
});
