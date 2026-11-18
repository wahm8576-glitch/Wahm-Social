/**
 * "Forgot password": always answers the same way (never reveals whether an email is registered).
 * Rate limited per IP and per email.
 * Prefers a branded SMTP mail with our /reset-password?oobCode= link. If SMTP is not
 * configured or the send fails, falls back to Firebase's own email (accounts:sendOobCode).
 * Legacy (Firebase off) still signs a 30-minute token and uses the branded template.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { signResetToken, RESET_TTL_MIN } from "@/lib/server/passwordReset";
import { sendMail, smtpFromAddress } from "@/lib/mail/send";
import { smtpDiag, smtpReady } from "@/lib/mail/config";
import { brandedActionEmail } from "@/lib/mail/templates";
import { publicOrigin } from "@/lib/admin/guard";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { adminAuth, createFirebaseUser, firebaseUserByEmail } from "@/lib/firebase/admin";
import { extractOobCode, greetingName, siteResetUrl } from "@/lib/firebase/links";
import { sendFirebaseOobEmail } from "@/lib/firebase/oob";
import { ensureFirebaseEmailTemplates } from "@/lib/firebase/emailTemplates";
import { logError, scrub } from "@/lib/server/errorLog";

const Body = z.object({ email: z.string().email().max(200) });
const GENERIC = { ok: true, data: { sent: true } };

function originOf(req: Request): string {
  return env.siteUrl.includes("localhost") ? publicOrigin(req) : env.siteUrl;
}

async function sendBrandedReset(opts: {
  to: string;
  name: string;
  link: string;
  origin: string;
  expiryNote?: string;
  enLine?: string;
}) {
  const mail = brandedActionEmail({
    kind: "reset",
    displayName: opts.name,
    link: opts.link,
    origin: opts.origin,
    expiryNote: opts.expiryNote,
    enLine: opts.enLine,
  });
  const r = await sendMail(
    { to: opts.to, subject: mail.subject, text: mail.text, html: mail.html, fromName: mail.fromName },
    undefined,
    { connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000 },
  );
  console.info(`[mail] password-reset path=smtp from=${r.fromAddress || smtpFromAddress()}`);
}

async function sendSmtpFirebaseReset(email: string, origin: string): Promise<boolean> {
  const siteUser = Users.byEmail(email);
  let fb = await firebaseUserByEmail(email);
  if (!fb && siteUser) {
    fb = await createFirebaseUser({ email, displayName: siteUser.name });
  }
  if (!fb) return false;
  const raw = await (await adminAuth()).generatePasswordResetLink(email, { url: `${origin}/reset-password` });
  const oob = extractOobCode(raw);
  if (!oob) throw new Error("Firebase link missing oobCode");
  const link = siteResetUrl(origin, oob);
  const name = greetingName(fb.displayName || siteUser?.name, email);
  await sendBrandedReset({ to: email, name, link, origin });
  return true;
}

async function fallbackFirebaseOob(email: string, origin: string, reason: string) {
  console.error(`[mail] smtp failed (${smtpDiag()}): ${scrub(reason)}; fallback=firebase-oob`);
  logError("mail", `smtp failed (${smtpDiag()}): ${scrub(reason)}; fallback=firebase-oob`);
  void ensureFirebaseEmailTemplates(origin);
  const result = await sendFirebaseOobEmail(email, "PASSWORD_RESET", `${origin}/reset-password`);
  console.info(`[mail] password-reset path=firebase-oob result=${result}`);
}

async function sendLegacyReset(email: string, origin: string) {
  const user = Users.byEmail(email);
  if (!user) return;
  const token = await signResetToken(user);
  const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  const name = greetingName(user.name, email);
  await sendBrandedReset({
    to: user.email,
    name,
    link,
    origin,
    expiryNote: `هذا الرابط صالح لمدة ${RESET_TTL_MIN} دقيقة ولمرة واحدة فقط.`,
    enLine: `We received a request to reset your Frostly password. This link expires in ${RESET_TTL_MIN} minutes and can be used once. If you didn’t request this, you can ignore this email.`,
  });
}

export const POST = handler(async (req: Request) => {
  burstGuard(req, "auth", 10);
  await getSettings();
  const ip = clientIp(req);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json(GENERIC);
  const email = parsed.data.email.toLowerCase();
  const perIp = rateLimit(`pwreset-ip:${ip}`, 5, 15 * 60_000);
  const perEmail = rateLimit(`pwreset-email:${email}`, 3, 60 * 60_000);
  if (!perIp.allowed) {
    return NextResponse.json(
      { ok: false, error: { code: "rate_limited", message: "محاولات كثيرة، جرّب بعد شوي. Too many requests, try again later." } },
      { status: 429 },
    );
  }
  if (!perEmail.allowed) return NextResponse.json(GENERIC);
  const origin = originOf(req);
  try {
    if (!firebaseEnabled()) {
      if (smtpReady()) await sendLegacyReset(email, origin);
      else console.error(`[mail] password-reset skipped: Firebase off and SMTP not ready (${smtpDiag()})`);
    } else if (smtpReady()) {
      try {
        const sent = await sendSmtpFirebaseReset(email, origin);
        if (!sent) {
          // No local record — still try Firebase so we don't miss a Firebase-only account.
          void ensureFirebaseEmailTemplates(origin);
          const result = await sendFirebaseOobEmail(email, "PASSWORD_RESET", `${origin}/reset-password`);
          console.info(`[mail] password-reset path=firebase-oob result=${result}`);
        }
      } catch (e) {
        const msg = scrub(String((e as Error)?.message ?? e));
        await fallbackFirebaseOob(email, origin, msg);
      }
    } else {
      console.error(`[mail] smtp not configured (${smtpDiag()}); fallback=firebase-oob`);
      void ensureFirebaseEmailTemplates(origin);
      const result = await sendFirebaseOobEmail(email, "PASSWORD_RESET", `${origin}/reset-password`);
      console.info(`[mail] password-reset path=firebase-oob result=${result}`);
    }
  } catch (e) {
    const msg = scrub(String((e as Error)?.message ?? e));
    logError("api", `password reset email failed: ${msg}`);
    console.error(`[mail] password-reset failed: ${msg}`);
  }
  return NextResponse.json(GENERIC);
});
