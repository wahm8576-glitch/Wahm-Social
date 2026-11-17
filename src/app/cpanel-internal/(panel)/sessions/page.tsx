import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { Section } from "@/components/admin/Section";
import { PoolManager } from "@/components/admin/pool/PoolManager";
import { rotations } from "@/lib/pools/rotate";
import { timeAgo } from "@/lib/format";
import { igSessionStatus } from "@/lib/platforms/instagram/session/browser";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SessionsPage({ searchParams }: { searchParams: Flashy }) {
  const { base } = await guardPage();
  const rot = rotations();
  const igErr = igSessionStatus();
  const igSet = Boolean(env.igSessionId);
  const ttSet = Boolean(env.tiktokCookie || env.tiktokSessionId);
  const stateLabel: Record<string, string> = {
    checkpoint: "⚠️ انستقرام طلب تحقق أمني (checkpoint) — حدّث الجلسة",
    logged_out: "⚠️ الجلسة سجّلت خروج — حدّث الكوكيز",
    error: "⚠️ خطأ في جلسة المتصفح",
  };
  return (
    <PanelShell active="sessions" title="الجلسات" flash={searchParams}>
      <PoolManager
        kind="tiktok"
        base={base}
        title="🎵 جلسات تيك توك"
        desc="تُستخدم لقوائم المتابعين/المتابَعين. لو الجلسة النشطة فشلت والقائمة فيها أكثر من وحدة، الموقع ينتقل للي بعدها تلقائياً ويعيد المحاولة. القيم مشفّرة وما تنعرض."
      />
      <PoolManager
        kind="instagram"
        base={base}
        title="📸 جلسات انستقرام"
        desc="تُستخدم للملف الشخصي والمنشورات والستوري والمتابعين. إذا انستقرام طلب تسجيل دخول (login_required / checkpoint) ننتقل للجلسة التالية. كل الطلبات تمر عبر البروكسي."
      />
      <Section title="🩺 حالة الجلسات">
        <ul className="space-y-1 text-sm text-ink-2">
          <li>تيك توك (متابعين/متابَعين فقط): {ttSet ? "✅ محفوظة" : "⚪ غير محفوظة"}</li>
          <li>انستقرام (كل شيء): {igSet ? "✅ محفوظة" : "⚪ غير محفوظة"}</li>
          <li>آخر حالة لجلسة انستقرام في المتصفح: {igErr ? `${stateLabel[igErr.state] ?? igErr.state} · ${timeAgo(igErr.at, "ar")}` : "✅ سليمة (ما فيه مشاكل مسجّلة)"}</li>
        </ul>
      </Section>
      <Section title="🔁 آخر التبديلات التلقائية">
        {rot.length === 0 ? (
          <p className="text-sm text-ink-3">ما صار أي تبديل منذ آخر تشغيل للسيرفر.</p>
        ) : (
          <ul className="space-y-1 text-sm text-ink-2">
            {rot.map((r, i) => (
              <li key={i}>
                {r.kind === "tiktok" ? "تيك توك" : "انستقرام"} ← الجلسة رقم {r.to + 1} · {timeAgo(Date.parse(r.at), "ar")}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PanelShell>
  );
}
