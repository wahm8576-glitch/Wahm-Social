/**
 * Send a branded email-verification message (SMTP) for the signed-in user.
 * Always succeeds from the client's point of view unless rate-limited or unauthenticated.
 */
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { rateLimit } from "@/lib/server/rateLimit";
import { sendMail } from "@/lib/mail/send";
import { brandedActionEmail } from "@/lib/mail/templates";
import { publicOrigin } from "@/lib/admin/guard";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { adminAuth, firebaseUserByEmail } from "@/lib/firebase/admin";
import { extractOobCode, greetingName, siteVerifyUrl } from "@/lib/firebase/links";
import { logError } from "@/lib/server/errorLog";

const OK = { ok: true, data: { sent: true } };

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  await getSettings();
  if (!firebaseEnabled()) return NextResponse.json(OK);
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: { code: "unauthorized", message: "سجّل دخول أولاً." } }, { status: 401 });
  if (!rateLimit(`fbverify:${user.id}`, 5, 60 * 60_000).allowed) {
    return NextResponse.json(
      { ok: false, error: { code: "rate_limited", message: "محاولات كثيرة، جرّب بعد شوي. Too many requests, try again later." } },
      { status: 429 },
    );
  }
  const origin = env.siteUrl.includes("localhost") ? publicOrigin(req) : env.siteUrl;
  try {
    const fb = await firebaseUserByEmail(user.email);
    if (!fb) return NextResponse.json(OK);
    if (fb.emailVerified) return NextResponse.json(OK);
    const raw = await (await adminAuth()).generateEmailVerificationLink(user.email, { url: `${origin}/login` });
    const oob = extractOobCode(raw);
    if (!oob) {
      logError("api", "email verification: Firebase link missing oobCode");
      return NextResponse.json(OK);
    }
    const link = siteVerifyUrl(origin, oob);
    const name = greetingName(fb.displayName || user.name, user.email);
    const mail = brandedActionEmail({ kind: "verify", displayName: name, link, origin });
    await sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html, fromName: mail.fromName });
  } catch (e) {
    logError("api", `verification email failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
  return NextResponse.json(OK);
});
