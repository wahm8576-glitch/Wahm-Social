/**
 * "Forgot password": always answers the same way (never reveals whether an email is registered).
 * Rate limited per IP and per email. When Firebase is on, the server generates an oobCode and
 * sends a branded Frostly email via SMTP (never Firebase's default template).
 * Legacy (Firebase off) still signs a 30-minute token and uses the same branded template.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Users } from "@/lib/server/db";
import { burstGuard } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";
import { signResetToken, RESET_TTL_MIN } from "@/lib/server/passwordReset";
import { sendMail, smtpFromAddress } from "@/lib/mail/send";
import { brandedActionEmail } from "@/lib/mail/templates";
import { publicOrigin } from "@/lib/admin/guard";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/site/store";
import { firebaseEnabled } from "@/lib/firebase/config";
import { adminAuth, createFirebaseUser, firebaseUserByEmail } from "@/lib/firebase/admin";
import { extractOobCode, greetingName, siteResetUrl } from "@/lib/firebase/links";
import { logError } from "@/lib/server/errorLog";

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
  const r = await sendMail({
    to: opts.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    fromName: mail.fromName,
  });
  // Address only — never the password or oobCode.
  console.info(`[mail] password-reset queued from=${r.fromAddress || smtpFromAddress()}`);
}

async function sendFirebaseReset(email: string, origin: string) {
  const siteUser = Users.byEmail(email);
  let fb = await firebaseUserByEmail(email);
  if (!fb && siteUser) {
    fb = await createFirebaseUser({ email, displayName: siteUser.name });
  }
  if (!fb) return;
  const raw = await (await adminAuth()).generatePasswordResetLink(email, { url: `${origin}/login` });
  const oob = extractOobCode(raw);
  if (!oob) {
    logError("api", "password reset: Firebase link missing oobCode");
    return;
  }
  const link = siteResetUrl(origin, oob);
  const name = greetingName(fb.displayName || siteUser?.name, email);
  await sendBrandedReset({ to: email, name, link, origin });
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
  // Await the send so the work is not dropped when the response is flushed.
  // Always the same JSON so the client cannot tell whether the account exists.
  try {
    if (firebaseEnabled()) await sendFirebaseReset(email, origin);
    else await sendLegacyReset(email, origin);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 120);
    logError("api", `password reset email failed: ${msg}`);
    console.error(`[mail] password-reset failed: ${msg}`);
  }
  return NextResponse.json(GENERIC);
});
