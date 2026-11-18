/**
 * Optionally customize Firebase's own Auth email templates + action URL via
 * Identity Toolkit projects.updateConfig. Failures are logged, never thrown.
 */
import { logoUrl, BRAND_FROM_NAME, RESET_SUBJECT, VERIFY_SUBJECT } from "@/lib/mail/templates";
import { readServiceAccount } from "./config";
import { adminApp } from "./admin";
import { scrub } from "@/lib/server/errorLog";

const g = globalThis as unknown as { __fbMailTpl?: "ok" | "skip" | "fail" };

const RESET_BODY = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><body style="margin:0;padding:0;background:#e8eef2;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e8eef2" style="background:#e8eef2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #d5e0e8;">
<tr><td bgcolor="#0b1f2a" style="background:#0b1f2a;padding:0;text-align:center;">
<img src="LOGO_URL" width="600" alt="Frostly | فروستلي" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
</td></tr>
<tr><td dir="rtl" style="padding:28px 32px;text-align:right;">
<p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#0b1f2a;">مرحباً %DISPLAY_NAME%</p>
<h1 style="margin:0 0 12px;font-size:22px;color:#0b1f2a;">إعادة تعيين كلمة المرور</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.9;color:#1e3342;">وصلنا طلب لإعادة تعيين كلمة المرور لحسابك في فروستلي. اضغط الزر أدناه لاختيار كلمة مرور جديدة.</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px;"><tr><td bgcolor="#4f6ff0" style="background:#4f6ff0;border-radius:10px;">
<a href="%LINK%" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">تعيين كلمة مرور جديدة</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:13px;line-height:1.8;color:#5b7384;">هذا الرابط صالح لمدة ساعة واحدة ولمرة واحدة فقط.</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.8;color:#5b7384;">إذا لم تطلب إعادة تعيين كلمة المرور، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.</p>
<p dir="ltr" style="margin:0;font-size:12px;line-height:1.6;color:#5b7384;text-align:left;">We received a request to reset your Frostly password. This link expires in 1 hour. If you didn’t request this, ignore this email.</p>
</td></tr>
<tr><td bgcolor="#f4f7f9" style="background:#f4f7f9;padding:16px 32px 20px;text-align:center;font-size:12px;color:#5b7384;">
Frostly | فروستلي<br>%APP_NAME%
</td></tr>
</table></td></tr></table>
</body></html>`;

const VERIFY_BODY = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><body style="margin:0;padding:0;background:#e8eef2;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e8eef2" style="background:#e8eef2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #d5e0e8;">
<tr><td bgcolor="#0b1f2a" style="background:#0b1f2a;padding:0;text-align:center;">
<img src="LOGO_URL" width="600" alt="Frostly | فروستلي" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
</td></tr>
<tr><td dir="rtl" style="padding:28px 32px;text-align:right;">
<p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#0b1f2a;">مرحباً %DISPLAY_NAME%</p>
<h1 style="margin:0 0 12px;font-size:22px;color:#0b1f2a;">تأكيد البريد الإلكتروني</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.9;color:#1e3342;">شكراً لتسجيلك في فروستلي. اضغط الزر أدناه لتأكيد بريدك الإلكتروني وتفعيل حسابك.</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px;"><tr><td bgcolor="#4f6ff0" style="background:#4f6ff0;border-radius:10px;">
<a href="%LINK%" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">تأكيد البريد الإلكتروني</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:13px;line-height:1.8;color:#5b7384;">رابط التأكيد صالح لمدة ساعة واحدة.</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.8;color:#5b7384;">إذا لم تُنشئ حساباً لدينا، يمكنك تجاهل هذه الرسالة بأمان.</p>
<p dir="ltr" style="margin:0;font-size:12px;line-height:1.6;color:#5b7384;text-align:left;">Please confirm your email address to activate your Frostly account. This link expires in 1 hour. If you didn’t create an account, ignore this message.</p>
</td></tr>
<tr><td bgcolor="#f4f7f9" style="background:#f4f7f9;padding:16px 32px 20px;text-align:center;font-size:12px;color:#5b7384;">
Frostly | فروستلي<br>%APP_NAME%
</td></tr>
</table></td></tr></table>
</body></html>`;

function template(kind: "reset" | "verify", origin: string) {
  const logo = logoUrl(origin);
  const body = (kind === "reset" ? RESET_BODY : VERIFY_BODY).replaceAll("LOGO_URL", logo);
  return {
    senderDisplayName: BRAND_FROM_NAME,
    subject: kind === "reset" ? RESET_SUBJECT : VERIFY_SUBJECT,
    body,
    bodyFormat: "HTML",
  };
}

async function accessToken(): Promise<string> {
  const app = await adminApp();
  const cred = app.options.credential;
  if (!cred?.getAccessToken) throw new Error("Firebase credential cannot mint an access token");
  const t = await cred.getAccessToken();
  if (!t?.access_token) throw new Error("Firebase access token empty");
  return t.access_token;
}

/** Best-effort: set action URL + branded Firebase templates once per process. */
export async function ensureFirebaseEmailTemplates(origin: string): Promise<void> {
  if (g.__fbMailTpl) return;
  const sa = readServiceAccount();
  if (!sa) {
    g.__fbMailTpl = "skip";
    return;
  }
  try {
    const token = await accessToken();
    const callbackUri = `${origin.replace(/\/$/, "")}/reset-password`;
    const reset = template("reset", origin);
    const verify = template("verify", origin);
    const updateMask = [
      "notification.sendEmail.callbackUri",
      "notification.sendEmail.resetPasswordTemplate.senderDisplayName",
      "notification.sendEmail.resetPasswordTemplate.subject",
      "notification.sendEmail.resetPasswordTemplate.body",
      "notification.sendEmail.resetPasswordTemplate.bodyFormat",
      "notification.sendEmail.verifyEmailTemplate.senderDisplayName",
      "notification.sendEmail.verifyEmailTemplate.subject",
      "notification.sendEmail.verifyEmailTemplate.body",
      "notification.sendEmail.verifyEmailTemplate.bodyFormat",
    ].join(",");
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(sa.projectId)}/config?updateMask=${encodeURIComponent(updateMask)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          notification: {
            sendEmail: {
              callbackUri,
              resetPasswordTemplate: reset,
              verifyEmailTemplate: verify,
            },
          },
        }),
      },
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = scrub(String((j as { error?: { message?: string } })?.error?.message || r.status));
      console.error(`[mail] firebase template update failed: ${msg}`);
      g.__fbMailTpl = "fail";
      return;
    }
    console.info(`[mail] firebase templates updated callbackUri=${callbackUri}`);
    g.__fbMailTpl = "ok";
  } catch (e) {
    console.error(`[mail] firebase template update failed: ${scrub(String((e as Error)?.message ?? e))}`);
    g.__fbMailTpl = "fail";
  }
}
