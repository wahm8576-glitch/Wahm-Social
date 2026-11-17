import { adminAction } from "@/lib/admin/guard";
import { saveSecrets, getSettings } from "@/lib/site/store";
import { readSmtp, SMTP_KEY, type SmtpConfig } from "@/lib/mail/config";
import { sendMail } from "@/lib/mail/send";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const s = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);

/** op=save → store SMTP settings (password blank = keep). op=test → send a test email. op=clear → remove. */
export async function POST(req: Request) {
  return adminAction("email", async (_req, form) => {
    const op = s(form, "op");
    if (op === "clear") {
      await saveSecrets((cur) => {
        delete cur[SMTP_KEY];
        return cur;
      }, "admin: clear smtp");
      return "تم حذف إعدادات البريد";
    }
    if (op === "test") {
      await getSettings();
      const to = s(form, "to", 200);
      if (!EMAIL_RE.test(to)) throw new Error("اكتب بريد صحيح لإرسال رسالة الاختبار");
      try {
        await sendMail({
          to,
          subject: "رسالة اختبار — Frostly SMTP",
          text: "هذه رسالة اختبار من لوحة تحكم Frostly. إذا وصلتك فإعدادات البريد شغالة ✅\n\nThis is a test email from the Frostly admin panel.",
          html: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif"><h3>رسالة اختبار ✅</h3><p>إذا وصلتك هذه الرسالة فإعدادات البريد (SMTP) في Frostly شغالة.</p></div>',
        });
      } catch (e) {
        throw new Error(`فشل الإرسال: ${String((e as Error).message ?? e).replace(/\s+/g, " ").slice(0, 200)}`);
      }
      return `تم إرسال رسالة اختبار إلى ${to} ✅`;
    }
    // save
    const cur = readSmtp();
    const port = Number(s(form, "port", 6)) || 587;
    if (port < 1 || port > 65535) throw new Error("رقم المنفذ غير صحيح");
    const next: SmtpConfig = {
      host: s(form, "host", 200).replace(/^smtps?:\/\//i, ""),
      port,
      secure: form.get("secure") === "on",
      user: s(form, "user", 200),
      pass: String(form.get("pass") ?? "") || cur.pass,
      fromName: s(form, "fromName", 100).replace(/["<>\r\n]/g, ""),
      fromAddress: s(form, "fromAddress", 200),
      replyTo: s(form, "replyTo", 200),
    };
    if (form.get("clear_pass") === "on") next.pass = "";
    if (!next.host) throw new Error("اكتب عنوان خادم SMTP (Host)");
    for (const [k, v] of [["عنوان المرسل", next.fromAddress], ["الرد إلى", next.replyTo]] as const) {
      if (v && !EMAIL_RE.test(v)) throw new Error(`${k}: بريد غير صحيح`);
    }
    if (!next.fromAddress && !EMAIL_RE.test(next.user)) throw new Error("اكتب عنوان المرسل (From address)");
    await saveSecrets((c) => {
      c[SMTP_KEY] = JSON.stringify(next);
      return c;
    }, "admin: update smtp");
    return "تم حفظ إعدادات البريد (مشفّرة) ✅";
  })(req);
}
