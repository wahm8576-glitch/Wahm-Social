import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection } from "@/components/admin/Section";
import { Text, Submit } from "@/components/admin/Fields";
import { PoolManager } from "@/components/admin/pool/PoolManager";

export const dynamic = "force-dynamic";

export default async function ProxyPage({ searchParams }: { searchParams: Flashy }) {
  const { base } = await guardPage();
  return (
    <PanelShell active="proxy" title="البروكسي ومسارات Worker" flash={searchParams}>
      <PoolManager
        kind="proxies"
        base={base}
        title="🌐 البروكسيات (SCRAPER_PROXY)"
        desc="كل طلبات انستقرام (الواجهة والصفحات وصور/فيديو cdninstagram) — ما فيه أي طلب مباشر لانستقرام لما يكون فيه بروكسي — وجلسة تيك توك (المتابعين)، وطلبات tikwm/countik لما يكون الـ Worker متعطل، تمر من هنا. الترتيب = ترتيب الاحتياط: الأول أساسي، وإذا فشل (أو رجع 429 من انستقرام) ينتقل للي بعده تلقائياً، وإذا رفضت كل البروكسيات يجرب الـ Worker لطلبات انستقرام العامة (بدون جلسة). تقدر تضيف كذا بروكسي مرة وحدة (كل سطر بروكسي)، وترتبها بالأسهم، وتوقف/تشغل، وتختبر كل واحد. كلمات السر ما تنعرض أبداً."
      />
      <PoolManager
        kind="relays"
        base={base}
        title="☁️ مسارات Cloudflare Worker (RELAY_URL)"
        desc="طلبات GET العامة لـ www.tiktok.com و tikwm.com و countik.com تمر من الـ Worker الأول. إذا تعطل ينتقل للثاني، وإذا تعطلت كلها يرجع للاتصال المباشر/البروكسي. الطلبات اللي فيها Cookie ما تمر من الـ Worker."
      />
      <FormSection title="🧪 جرّب بروكسي بدون حفظ" desc="يجرب tiktok.com و tikwm.com و countik.com و instagram.com عبر الرابط اللي تكتبه (ما ينحفظ)." action={`${base}/api/proxy-test`}>
        <Text name="candidate" label="رابط البروكسي" type="password" dir="ltr" placeholder="http://user:pass@host:port" />
        <Submit label="اختبار الآن" />
      </FormSection>
      <FormSection title="🧪 جرّب Worker بدون حفظ" desc="يجرب صفحة حساب تيك توك وواجهة countik عبر الرابط." action={`${base}/api/proxy-test`}>
        <input type="hidden" name="mode" value="relay" />
        <Text name="relayCandidate" label="رابط الـ Worker" dir="ltr" placeholder="https://name.workers.dev" />
        <Submit label="اختبار الـ Worker الآن" />
      </FormSection>
    </PanelShell>
  );
}
