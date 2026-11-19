import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection } from "@/components/admin/Section";
import { Area, BiText, Text, Toggle, Submit } from "@/components/admin/Fields";

export const dynamic = "force-dynamic";

const SOCIAL: [string, string][] = [
  ["x", "X (تويتر)"],
  ["instagram", "انستقرام"],
  ["tiktok", "تيك توك"],
  ["youtube", "يوتيوب"],
  ["telegram", "تيليجرام"],
  ["whatsapp", "واتساب (رابط wa.me)"],
  ["snapchat", "سناب شات"],
];

export default async function SitePage({ searchParams }: { searchParams: Flashy }) {
  const { base, settings: s } = await guardPage();
  return (
    <PanelShell active="site" title="الصيانة والتحليلات والتواصل" flash={searchParams}>
      <FormSection title="🌐 عنوان الموقع العام" desc="اختياري. إذا ضبطته يُستخدم لروابط العودة في PayPal ولويب هوك Telegram. إذا فاضي، يُشتق تلقائياً من عنوان الطلب أو عنوان الاستضافة (مثل Render)، فالنقل لدومين أو سيرفر جديد يحدّث الويب هوك وحده." action={`${base}/api/save?section=publicUrl`}>
        <Text name="publicUrl" label="عنوان الموقع العام (https://…)" value={s.publicUrl} dir="ltr" placeholder="اتركه فاضي للاكتشاف التلقائي" />
        <Submit />
      </FormSection>
      <FormSection title="🛠️ وضع الصيانة" desc="إذا تشغّل، كل صفحات الموقع تعرض رسالتك وواجهات البحث ترجع 503. لوحة التحكم تبقى شغالة." action={`${base}/api/save?section=maintenance`}>
        <Toggle name="enabled" label="تشغيل وضع الصيانة" checked={s.maintenance.enabled} />
        <BiText name="message" label="رسالة الصيانة" value={s.maintenance.message} area />
        <Submit />
      </FormSection>
      <FormSection title="📈 التحليلات وأكواد الـ head" desc="Google Analytics يتفعل بمجرد ما تحط المعرّف. أكواد التحقق من Google/Bing في صفحة SEO." action={`${base}/api/save?section=head`}>
        <Text name="gaId" label="Google Analytics Measurement ID" value={s.head.gaId} dir="ltr" placeholder="G-XXXXXXXXXX" />
        <Area
          name="customHead"
          label="كود إضافي داخل <head> (اختياري)"
          value={s.head.customHead}
          rows={5}
          dir="ltr"
          hint="مثال: وسم meta أو سكربت تحليلات ثاني. انتبه: أي كود هنا يشتغل في كل صفحات الموقع."
        />
        <Submit />
      </FormSection>
      <FormSection title="📬 التواصل وروابط السوشال" desc="تظهر في الفوتر وصفحة تواصل معنا. اترك الخانة فاضية لإخفائها." action={`${base}/api/save?section=contact`}>
        <Text name="email" label="بريد التواصل" value={s.contact.email} dir="ltr" placeholder="hello@example.com" />
        <div className="grid gap-3 md:grid-cols-2">
          {SOCIAL.map(([k, label]) => (
            <Text key={k} name={k} label={label} value={s.contact[k as keyof typeof s.contact]} dir="ltr" placeholder="https://…" />
          ))}
        </div>
        <Submit />
      </FormSection>
    </PanelShell>
  );
}
