import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection, Section } from "@/components/admin/Section";
import { Area, Text, Submit } from "@/components/admin/Fields";
import { firebaseStatus } from "@/lib/firebase/config";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function FirebasePage({ searchParams }: { searchParams: Flashy }) {
  const { base } = await guardPage();
  const st = firebaseStatus();
  const action = `${base}/api/firebase`;
  const w = st.web;
  return (
    <PanelShell active="firebase" title="Firebase (تسجيل الدخول)" flash={searchParams}>
      <Section title="الحالة">
        <ul className="space-y-1 text-sm text-ink-2">
          <li>{st.enabled ? "✅ تسجيل الدخول عبر Firebase مفعّل (بريد/كلمة مرور + Google + استعادة كلمة المرور من Google)" : "⚪ غير مفعّل — الموقع يستخدم تسجيل الدخول القديم"}</li>
          <li>إعدادات الويب: {st.webComplete ? `✅ ${w.projectId}` : "❌ ناقصة"}</li>
          <li>
            حساب الخدمة: {st.sa ? `✅ ${st.sa.clientEmail} (${st.sa.source === "env" ? "من Render" : "من اللوحة"})` : st.saStoredButInvalid ? "❌ محفوظ لكنه غير صالح" : "❌ غير محفوظ"}
          </li>
          <li>
            مدراء الموقع (ADMIN_EMAILS): {env.adminEmails.length ? <span dir="ltr">{env.adminEmails.join(", ")}</span> : "❌ لا يوجد"} — صلاحية المدير تُعطى فقط لهذه الإيميلات بعد توثيقها (Google أو رابط التوثيق).
          </li>
          {st.projectMismatch && <li className="text-rose-500">❌ projectId في الويب لا يطابق حساب الخدمة</li>}
        </ul>
        <div className="flex flex-wrap gap-2">
          <form method="post" action={action}>
            <input type="hidden" name="op" value="test" />
            <button className="btn-ghost">🧪 اختبار</button>
          </form>
          {st.enabled ? (
            <form method="post" action={action}>
              <input type="hidden" name="op" value="disable" />
              <button className="btn-ghost text-amber-600">⏸️ إيقاف Firebase</button>
            </form>
          ) : (
            <form method="post" action={action}>
              <input type="hidden" name="op" value="enable" />
              <button className="btn-primary">▶️ تفعيل Firebase</button>
            </form>
          )}
        </div>
        <p className="text-xs text-ink-4">
          قبل التفعيل: فعّل Email/Password و Google في Authentication → Sign-in method، وأضف نطاق الموقع في Authentication → Settings → Authorized domains.
        </p>
      </Section>
      <FormSection title="🌐 إعدادات تطبيق الويب (عامة)" desc="من Project settings → General → Your apps → Web app. تقدر تلصق كود firebaseConfig كامل في الخانة الأولى بدل تعبئة الحقول." action={action}>
        <input type="hidden" name="op" value="save" />
        <Area name="snippet" label="لصق firebaseConfig (اختياري)" rows={4} dir="ltr" />
        <div className="grid gap-3 md:grid-cols-2">
          <Text name="apiKey" label="apiKey" value={w.apiKey} dir="ltr" />
          <Text name="authDomain" label="authDomain" value={w.authDomain} dir="ltr" placeholder="your-project.firebaseapp.com" />
          <Text name="projectId" label="projectId" value={w.projectId} dir="ltr" />
          <Text name="appId" label="appId" value={w.appId} dir="ltr" />
          <Text name="messagingSenderId" label="messagingSenderId (اختياري)" value={w.messagingSenderId} dir="ltr" />
          <Text name="storageBucket" label="storageBucket (اختياري)" value={w.storageBucket} dir="ltr" />
        </div>
        <Area
          name="serviceAccount"
          label="🔐 حساب الخدمة — Service account JSON (سري)"
          rows={5}
          dir="ltr"
          hint={st.sa ? "محفوظ ✅ — اتركه فاضي عشان يبقى. ما ينعرض أبداً." : "Project settings → Service accounts → Generate new private key، والصق محتوى الملف كامل."}
        />
        <Submit label="حفظ إعدادات Firebase" />
      </FormSection>
      <FormSection title="🗑️ حذف إعدادات Firebase" action={action}>
        <input type="hidden" name="op" value="clear" />
        <button type="submit" className="btn-ghost text-rose-500">حذف كل إعدادات Firebase والرجوع لتسجيل الدخول القديم</button>
      </FormSection>
    </PanelShell>
  );
}
