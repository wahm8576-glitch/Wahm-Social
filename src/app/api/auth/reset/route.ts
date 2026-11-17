import { NextResponse } from "next/server";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { hashPassword, publicUser, sessionCookie, signSession } from "@/lib/server/auth";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { verifyResetToken } from "@/lib/server/passwordReset";
import { PlatformError } from "@/lib/platforms/types";

const Body = z.object({ token: z.string().min(20).max(2000), password: z.string().min(8).max(200) });

/** Set a new password with a valid reset token, then sign the user in. */
export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new PlatformError("invalid_input", "كلمة المرور لازم تكون 8 أحرف على الأقل. Password must be at least 8 characters.", 400);
  const user = await verifyResetToken(parsed.data.token, Users.byId);
  if (!user) throw new PlatformError("invalid_input", "الرابط غير صالح أو انتهت صلاحيته. اطلب رابط جديد. This link is invalid or expired.", 400);
  const updated = Users.update(user.id, { passwordHash: await hashPassword(parsed.data.password), lastLoginAt: Date.now() });
  const res = NextResponse.json({ ok: true, data: publicUser(updated ?? user) });
  res.cookies.set(sessionCookie(await signSession(user.id)));
  return res;
});
