import { NextResponse } from "next/server";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { hashPassword, publicUser, sessionCookie, signSession } from "@/lib/server/auth";
import { env } from "@/lib/env";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { PlatformError } from "@/lib/platforms/types";

const Body = z.object({
  email: z.string().email().max(120),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(60).optional(),
});

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  await getSettings();
  if (firebaseEnabled()) throw new PlatformError("invalid_input", "تسجيل الدخول صار عبر Firebase — حدّث الصفحة. Sign-in now uses Firebase, reload the page.", 410);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new PlatformError("invalid_input", "Enter a valid email and a password of at least 8 characters", 400);
  const { email, password, name } = parsed.data;
  if (Users.byEmail(email)) throw new PlatformError("invalid_input", "This email is already registered", 409);
  const user = Users.create({
    email,
    name: name ?? email.split("@")[0],
    passwordHash: await hashPassword(password),
    plan: "free",
    role: env.adminEmails.includes(email.toLowerCase()) || Users.all().length === 0 ? "admin" : "user",
  });
  const res = NextResponse.json({ ok: true, data: publicUser(user) });
  res.cookies.set(sessionCookie(await signSession(user.id)));
  return res;
});
