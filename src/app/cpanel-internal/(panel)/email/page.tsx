import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection, Section } from "@/components/admin/Section";
import { Text, Toggle, Submit } from "@/components/admin/Fields";
import { smtpPublic, smtpReady, readSmtp } from "@/lib/mail/config";

export const dynamic = "force-dynamic";

export default async function EmailPage({ searchParams }: { searchParams: Flashy }) {
  const { base } = await guardPage();
  const c = smtpPublic();
  const ready = smtpReady(readSmtp());
  const action = `${base}/api/smtp`;
  return (
    <PanelShell active="email" title="البريد / SMTP" flash={searchParams}>
      <Section title="الحالة">
        <p className={`text-sm font-semibold ${ready ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
          {ready ? "✅ البريد مضبوط — رسائل «نسيت كلمة المرور» بتنرسل من خلاله." : "⚠️ البريد غير مضبوط — رسائل «نسيت كلمة المرور» ما بتنرسل لين تعبّي الإعدادات."}
        </p>
        <p className="text-xs text-ink-4">صفحة الاستعادة للمستخدمين: /forgot-password · الرابط في الإيميل صالح 30 دقيقة ولمرة وحدة.</p>
      </Section>
      <FormSection title="✉️ إعدادات خادم البريد (SMTP)" desc="تنحفظ مشفّرة مع باقي الأسرار. كلمة المرور ما تنعرض أبداً — اتركها فاضية عشان تبقى القديمة." action={action}>
        <input type="hidden" name="op" value="save" />
        <div className="grid gap-3 md:grid-cols-2">
          <Text name="host" label="الخادم (Host)" value={c.host} dir="ltr" placeholder="smtp.gmail.com" />
          <Text name="port" label="المنفذ (Port)" value={String(c.port)} dir="ltr" type="number" hint="587 مع STARTTLS، أو 465 مع SSL" />
          <Text name="user" label="اسم المستخدم (البريد)" value={c.user} dir="ltr" placeholder="you@example.com" />
          <Text
            name="pass"
            label="كلمة المرور / App password"
            type="password"
            dir="ltr"
            placeholder={c.hasPass ? "•••••••• (محفوظة — اتركها فاضية)" : "غير محفوظة"}
            hint={c.hasPass ? "محفوظة ✅ — اكتب قيمة جديدة فقط لو تبي تغيّرها" : "لـ Gmail استخدم App Password وليس كلمة مرور الحساب"}
          />
          <Text name="fromName" label="اسم المرسل" value={c.fromName} placeholder="Frostly" />
          <Text name="fromAddress" label="عنوان المرسل (From)" value={c.fromAddress} dir="ltr" placeholder="no-reply@example.com" />
          <Text name="replyTo" label="الرد إلى (Reply-To) — اختياري" value={c.replyTo} dir="ltr" />
        </div>
        <Toggle name="secure" label="اتصال آمن SSL/TLS مباشر (Secure)" checked={c.secure} hint="فعّلها مع المنفذ 465. للمنفذ 587 خلّها مطفية (يستخدم STARTTLS تلقائياً)." />
        {c.hasPass && <Toggle name="clear_pass" label="حذف كلمة المرور المحفوظة" checked={false} />}
        <Submit label="حفظ إعدادات البريد" />
      </FormSection>
      <FormSection title="📨 إرسال رسالة اختبار" desc="يستخدم الإعدادات المحفوظة. احفظ أولاً ثم جرّب." action={action}>
        <input type="hidden" name="op" value="test" />
        <Text name="to" label="أرسل إلى" dir="ltr" type="email" placeholder="you@example.com" value={c.replyTo || c.fromAddress || c.user} />
        <Submit label="إرسال رسالة اختبار" />
      </FormSection>
      <FormSection title="🗑️ حذف إعدادات البريد" action={action}>
        <input type="hidden" name="op" value="clear" />
        <button type="submit" className="btn-ghost text-rose-500">حذف كل إعدادات SMTP</button>
      </FormSection>
    </PanelShell>
  );
}
