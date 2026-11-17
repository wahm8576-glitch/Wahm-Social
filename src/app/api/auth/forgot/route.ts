/**
 * "Forgot password": always answers the same way (never reveals whether an email is registered).
 * Rate limited per IP and per email. Sends a 30-minute reset link via the admin SMTP settings.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { signResetToken, RESET_TTL_MIN } from "@/lib/server/passwordReset";
import { sendMail } from "@/lib/mail/send";
import { publicOrigin } from "@/lib/admin/guard";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { logError } from "@/lib/server/errorLog";

const Body = z.object({ email: z.string().email().max(200) });
const GENERIC = { ok: true, data: { sent: true } };

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  await getSettings();
  // Legacy email reset is only a fallback: with Firebase on, Google sends the reset email.
  if (firebaseEnabled()) return NextResponse.json({ ok: false, error: { code: "not_supported", message: "Password reset now uses Firebase, reload the page." } }, { status: 410 });
  const ip = clientIp(req);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json(GENERIC);
  const email = parsed.data.email.toLowerCase();
  const perIp = rateLimit(`pwreset-ip:${ip}`, 5, 15 * 60_000);
  const perEmail = rateLimit(`pwreset-email:${email}`, 3, 60 * 60_000);
  if (!perIp.allowed) {
    return NextResponse.json({ ok: false, error: { code: "rate_limited", message: "محاولات كثيرة، جرّب بعد شوي. Too many requests, try again later." } }, { status: 429 });
  }
  if (!perEmail.allowed) return NextResponse.json(GENERIC);
  const user = Users.byEmail(email);
  if (user) {
    await getSettings();
    const token = await signResetToken(user);
    // Prefer the configured site URL so a forged Host header can't redirect the link elsewhere.
    const origin = env.siteUrl.includes("localhost") ? publicOrigin(req) : env.siteUrl;
    const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
    const text = [
      "مرحباً،",
      "",
      "وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في Frostly.",
      `افتح الرابط التالي خلال ${RESET_TTL_MIN} دقيقة لتعيين كلمة مرور جديدة:`,
      link,
      "",
      "إذا ما طلبت هذا، تجاهل الرسالة وكلمة مرورك تبقى زي ما هي.",
      "",
      "---",
      `We received a request to reset your Frostly password. Open this link within ${RESET_TTL_MIN} minutes: ${link}`,
      "If you didn't request it, ignore this email.",
    ].join("\n");
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#0f172a">
<h2 style="margin:0 0 12px">إعادة تعيين كلمة المرور</h2>
<p>وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في <b>Frostly</b>.</p>
<p><a href="${link}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">تعيين كلمة مرور جديدة</a></p>
<p style="font-size:13px;color:#475569">الرابط صالح لمدة ${RESET_TTL_MIN} دقيقة ولمرة وحدة. إذا ما طلبت هذا تجاهل الرسالة.</p>
<hr style="border:none;border-top:1px solid #e2e8f0"/>
<p dir="ltr" style="font-size:12px;color:#64748b">Reset your Frostly password (valid ${RESET_TTL_MIN} min): <a href="${link}">${link.replace(/token=.*/, "token=…")}</a></p>
</div>`;
    // Fire and forget: the response time must not depend on whether the account exists.
    void sendMail({ to: user.email, subject: "إعادة تعيين كلمة المرور — Frostly", text, html }).catch((e) =>
      logError("api", `password reset email failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`),
    );
  }
  return NextResponse.json(GENERIC);
});
