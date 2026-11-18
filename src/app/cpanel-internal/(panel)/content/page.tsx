import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection } from "@/components/admin/Section";
import { BiText, Toggle, Submit } from "@/components/admin/Fields";
import { ARTICLES } from "@/lib/content/blog";

export const dynamic = "force-dynamic";

const PAGES: ["about" | "privacy" | "terms" | "refund" | "contact", string][] = [
  ["about", "عن الموقع /about"],
  ["privacy", "سياسة الخصوصية /privacy"],
  ["terms", "شروط الاستخدام /terms"],
  ["refund", "سياسة الاسترجاع /refund"],
  ["contact", "تواصل معنا /contact"],
];

export default async function ContentPage({ searchParams }: { searchParams: Flashy }) {
  const { base, settings: s } = await guardPage();
  const hidden = new Set(s.blog.hidden);
  return (
    <PanelShell active="content" title="الصفحات والمدونة" flash={searchParams}>
      <FormSection
        title="📄 نصوص الصفحات"
        desc="تقبل Markdown (## عنوان، - نقطة، **عريض**). اترك الخانة فاضية عشان يرجع النص الأصلي."
        action={`${base}/api/save?section=pages`}
      >
        {PAGES.map(([k, label]) => (
          <div key={k} className="space-y-2 rounded-2xl border border-line bg-surface/40 p-3">
            <p className="text-sm font-bold text-ink">{label}</p>
            <BiText name={k} label="النص" value={s.pages[k]} area />
          </div>
        ))}
        <Submit label="حفظ الصفحات" />
      </FormSection>
      <FormSection title="📝 المدونة" desc="أطفِ المدونة كاملة، أو أخفِ مقالات معيّنة (تختفي من القائمة وخريطة الموقع وترجع 404)." action={`${base}/api/save?section=blog`}>
        <Toggle name="enabled" label="تشغيل المدونة" checked={s.blog.enabled} />
        <div className="grid gap-2 md:grid-cols-2">
          {ARTICLES.map((a) => (
            <Toggle key={a.slug} name={`show_${a.slug}`} label={a.title.ar} hint={`/blog/${a.slug}`} checked={!hidden.has(a.slug)} />
          ))}
        </div>
        <Submit label="حفظ المدونة" />
      </FormSection>
    </PanelShell>
  );
}
