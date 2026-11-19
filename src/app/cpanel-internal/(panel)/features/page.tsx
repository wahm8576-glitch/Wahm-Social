import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection } from "@/components/admin/Section";
import { Select, Text, Toggle, Submit } from "@/components/admin/Fields";

export const dynamic = "force-dynamic";

export default async function FeaturesPage({ searchParams }: { searchParams: Flashy }) {
  const { base, settings: s } = await guardPage();
  const f = s.features;
  return (
    <PanelShell active="features" title="الميزات والأسعار" flash={searchParams}>
      <FormSection title="🎛️ تشغيل وإيقاف" desc="أي ميزة تطفيها تختفي من الموقع وترجع رسالة واضحة للزائر." action={`${base}/api/save?section=features`}>
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle name="tiktok" label="منصة تيك توك" checked={f.tiktok} />
          <Toggle name="instagram" label="منصة انستقرام" checked={f.instagram} />
          <Toggle name="followers" label="قائمة المتابعين" checked={f.followers} />
          <Toggle name="following" label="قائمة المتابَعين (Following)" checked={f.following} />
          <Toggle name="stories" label="الستوري" checked={f.stories} />
          <Toggle name="downloads" label="التحميل" checked={f.downloads} />
          <Toggle name="posts" label="عرض المنشورات في صفحة الحساب" checked={f.posts} />
          <Toggle name="region" label="دولة الحساب (من الفيديوهات)" checked={f.region} />
          <Toggle name="search" label="صفحة البحث" checked={f.search} />
          <Toggle name="analytics" label="التحليلات" checked={f.analytics} />
          <Toggle name="pro" label="اشتراكات برو (المدفوعة)" checked={f.pro} />
        </div>
        <Select
          name="demoMode"
          label="وضع البيانات التجريبية DEMO_MODE"
          value={f.demoMode}
          options={[
            ["", "حسب إعداد Render (الافتراضي)"],
            ["auto", "auto — تجريبي فقط إذا فشل المصدر"],
            ["on", "on — بيانات تجريبية دائماً"],
            ["off", "off — بدون بيانات تجريبية"],
          ]}
        />
        <p className="text-sm font-semibold text-ink-2">💲 الأسعار (دولار)</p>
        <div className="grid gap-3 md:grid-cols-4">
          <Text name="proMonthly" label="برو شهري" value={String(f.prices.proMonthly)} dir="ltr" type="number" />
          <Text name="proYearly" label="برو سنوي" value={String(f.prices.proYearly)} dir="ltr" type="number" />
          <Text name="bizMonthly" label="أعمال شهري" value={String(f.prices.bizMonthly)} dir="ltr" type="number" />
          <Text name="bizYearly" label="أعمال سنوي" value={String(f.prices.bizYearly)} dir="ltr" type="number" />
        </div>
        <p className="text-sm font-semibold text-ink-2">⭐ أسعار نجوم Telegram</p>
        <p className="text-xs text-ink-4">الافتراضي تقريباً سعر الدولار × 77 مقرّب لرقم مريح. اترك 0 أو عدّل. الشهري اشتراك يتجدد، السنوي دفعة واحدة.</p>
        <div className="grid gap-3 md:grid-cols-4">
          <Text name="starProMonthly" label="برو شهري (نجوم)" value={String(f.starPrices?.proMonthly ?? 599)} dir="ltr" type="number" />
          <Text name="starProYearly" label="برو سنوي (نجوم)" value={String(f.starPrices?.proYearly ?? 4599)} dir="ltr" type="number" />
          <Text name="starBizMonthly" label="أعمال شهري (نجوم)" value={String(f.starPrices?.bizMonthly ?? 2299)} dir="ltr" type="number" />
          <Text name="starBizYearly" label="أعمال سنوي (نجوم)" value={String(f.starPrices?.bizYearly ?? 19199)} dir="ltr" type="number" />
        </div>
        <p className="text-xs text-ink-4">ملاحظة: إذا تستخدم Stripe أو PayPal بأسعار ثابتة لازم تعدّلها عند الموفّر كمان.</p>
        <Submit />
      </FormSection>
    </PanelShell>
  );
}
