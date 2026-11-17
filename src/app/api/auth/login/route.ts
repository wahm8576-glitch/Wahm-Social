import { NextResponse } from "next/server";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { publicUser, sessionCookie, signSession, verifyPassword } from "@/lib/server/auth";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { PlatformError } from "@/lib/platforms/types";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  await getSettings();
  if (firebaseEnabled()) throw new PlatformError("invalid_input", "تسجيل الدخول صار عبر Firebase — حدّث الصفحة. Sign-in now uses Firebase, reload the page.", 410);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new PlatformError("invalid_input", "Invalid credentials", 400);
  const user = Users.byEmail(parsed.data.email);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    throw new PlatformError("unauthorized", "Invalid email or password", 401);
  }
  Users.update(user.id, { lastLoginAt: Date.now() });
  const res = NextResponse.json({ ok: true, data: publicUser(user) });
  res.cookies.set(sessionCookie(await signSession(user.id)));
  return res;
});
