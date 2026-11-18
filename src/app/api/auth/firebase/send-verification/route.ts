/**
 * Send a branded verification email for the signed-in user (Brevo, then SMTP, then Firebase oob).
 */
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { rateLimit } from "@/lib/server/rateLimit";
import { brandedTransportReady, deliverBrandedMail } from "@/lib/mail/deliver";
import { brevoDiag } from "@/lib/mail/brevo";
import { smtpDiag } from "@/lib/mail/config";
import { brandedActionEmail } from "@/lib/mail/templates";
import { publicOrigin } from "@/lib/admin/guard";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { adminAuth, firebaseUserByEmail } from "@/lib/firebase/admin";
import { extractOobCode, greetingName, siteVerifyUrl } from "@/lib/firebase/links";
import { sendFirebaseOobEmail } from "@/lib/firebase/oob";
import { ensureFirebaseEmailTemplates } from "@/lib/firebase/emailTemplates";
import { logError, scrub } from "@/lib/server/errorLog";

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
  const fallback = async (reason: string) => {
    console.error(`[mail] verify branded failed (${brevoDiag()}; ${smtpDiag()}): ${scrub(reason)}; fallback=firebase-oob`);
    logError("mail", `verify branded failed: ${scrub(reason)}; fallback=firebase-oob`);
    void ensureFirebaseEmailTemplates(origin);
    const result = await sendFirebaseOobEmail(user.email, "VERIFY_EMAIL", `${origin}/login`);
    console.info(`[mail] verification path=firebase-oob result=${result}`);
  };
  try {
    const fb = await firebaseUserByEmail(user.email);
    if (!fb) return NextResponse.json(OK);
    if (fb.emailVerified) return NextResponse.json(OK);
    if (!brandedTransportReady()) {
      await fallback("not configured");
      return NextResponse.json(OK);
    }
    try {
      const raw = await (await adminAuth()).generateEmailVerificationLink(user.email, { url: `${origin}/login` });
      const oob = extractOobCode(raw);
      if (!oob) throw new Error("Firebase link missing oobCode");
      const link = siteVerifyUrl(origin, oob);
      const name = greetingName(fb.displayName || user.name, user.email);
      const mail = brandedActionEmail({ kind: "verify", displayName: name, link, origin });
      const r = await deliverBrandedMail({
        to: user.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        fromName: mail.fromName,
      });
      console.info(`[mail] verification path=${r.path} result=sent messageId=${r.messageId || "none"}`);
    } catch (e) {
      await fallback(String((e as Error)?.message ?? e));
    }
  } catch (e) {
    logError("api", `verification email failed: ${scrub(String((e as Error)?.message ?? e))}`);
    console.error(`[mail] verification failed: ${scrub(String((e as Error)?.message ?? e))}`);
  }
  return NextResponse.json(OK);
});
