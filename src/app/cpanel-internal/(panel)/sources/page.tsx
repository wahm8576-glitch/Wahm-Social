import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { Section } from "@/components/admin/Section";
import { servedLog, sourceStats } from "@/lib/sources/health";
import { probeSources, type ProbeRow } from "@/lib/sources/probe";
import { healthyProxyCount, proxyList } from "@/lib/server/http";
import { relayList } from "@/lib/server/relay";

export const dynamic = "force-dynamic";

const ORDER: Record<string, string> = {
  "tt-page": "تيك توك — صفحة الحساب الرسمية",
  "tt-embed": "تيك توك — صفحة التضمين /embed",
  countik: "countik.com (أرقام دقيقة)",
  tikwm: "tikwm.com",
  "ig-api": "انستقرام — web_profile_info (جلسة/بدون)",
  dumpor: "dumpor.io (مرآة عامة)",
  "ig-preview": "انستقرام — معاينة الرابط (og)",
  "tt-stories": "تيك توك — ستوري (واجهة تيك توك نفسها)",
  savetik: "savetik.co (تحميل بدون علامة)",
  tikdownloader: "tikdownloader.io (تحميل بدون علامة)",
};

const ago = (t?: number) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))}ث` : "—");
const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh" });

export default async function SourcesPage({ searchParams }: { searchParams: Flashy & { p?: string; u?: string } }) {
  const { base } = await guardPage();
  const platform = searchParams.p === "instagram" ? "instagram" : "tiktok";
  const user = String(searchParams.u ?? "").trim().replace(/^@/, "").slice(0, 40);
  let probe: ProbeRow[] | null = null;
  if (/^[A-Za-z0-9._]{1,40}$/.test(user)) probe = await probeSources(platform, user);
  const stats = sourceStats();
  const log = servedLog().slice(0, 40);
  const proxies = proxyList().length;
  return (
    <PanelShell active="sources" title="مصادر البيانات" flash={searchParams}>
      <Section title="الطرق (بالترتيب)">
        <ul className="space-y-1 text-sm text-ink-2">
          <li>1) البروكسي: {proxies ? `${healthyProxyCount("main")}/${proxies} سليم (عام) · ${healthyProxyCount("ig")}/${proxies} سليم (انستقرام)` : "⚪ لا يوجد"}</li>
          <li>2) طلب مباشر من السيرفر (بدون بروكسي) — دايم مفعّل كاحتياط</li>
          <li>3) Cloudflare Worker: {relayList().length ? `✅ ${relayList().length} رابط` : "⚪ غير مضبوط (RELAY_URL)"}</li>
        </ul>
        <p className="text-xs text-ink-4">كل مصدر له مهلة قصيرة، والمصدر اللي يفشل 3 مرات ورا بعض يتوقف 5 دقايق تلقائياً. لو كل المصادر فشلت نعرض آخر بيانات حقيقية محفوظة (ذاكرة + Firestore) — ما نعرض بيانات وهمية.</p>
        <form method="post" action={`${base}/api/sources`}>
          <input type="hidden" name="op" value="reset" />
          <button className="btn-ghost">🔄 تصفير القواطع</button>
        </form>
      </Section>

      <Section title="🧪 اختبار المصادر من السيرفر">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <select name="p" defaultValue={platform} className="rounded-xl border border-line bg-surface/70 px-3 py-2 text-sm text-ink w-40">
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
          </select>
          <input name="u" defaultValue={user} placeholder="username" dir="ltr" className="rounded-xl border border-line bg-surface/70 px-3 py-2 text-sm text-ink w-56" />
          <button className="btn-primary">اختبار</button>
        </form>
        {probe && (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-ink-4">
                <th className="text-start">المصدر</th>
                <th className="text-start">النتيجة</th>
                <th className="text-start">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {probe.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1">{ORDER[r.id] ?? r.id}</td>
                  <td dir="ltr" className={r.ok ? "text-emerald-600" : "text-rose-500"}>{r.ok ? `✅ ${r.summary}` : `❌ ${r.error}`}</td>
                  <td>{(r.ms / 1000).toFixed(1)}ث</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Section>

      <Section title="صحة كل مصدر (منذ آخر تشغيل)">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-ink-4">
              <th className="text-start">المصدر</th>
              <th className="text-start">نجاح</th>
              <th className="text-start">فشل</th>
              <th className="text-start">متوسط</th>
              <th className="text-start">آخر نجاح</th>
              <th className="text-start">آخر خطأ</th>
              <th className="text-start">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="py-1">{ORDER[s.id] ?? s.id}</td>
                <td>{s.ok}</td>
                <td>{s.fail}</td>
                <td>{(s.avgMs / 1000).toFixed(1)}ث</td>
                <td>{ago(s.lastOkAt)}</td>
                <td dir="ltr" className="text-xs text-ink-3">{s.lastError ?? "—"}</td>
                <td>{s.openUntil && s.openUntil > Date.now() ? "⛔ موقوف مؤقتاً" : "✅"}</td>
              </tr>
            ))}
            {!stats.length && (
              <tr>
                <td colSpan={7} className="py-2 text-ink-4">ما فيه طلبات بعد منذ آخر تشغيل.</td>
              </tr>
            )}
          </tbody>
        </table></div>
      </Section>

      <Section title="آخر الطلبات — مين خدمها">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-ink-4">
              <th className="text-start">الوقت (الرياض)</th>
              <th className="text-start">الحساب</th>
              <th className="text-start">المصدر</th>
              <th className="text-start">المدة</th>
              <th className="text-start">المحاولات</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{time(e.at)}</td>
                <td dir="ltr">{e.key.replace(/^profile:/, "")}</td>
                <td className={e.source === "none" ? "text-rose-500" : ""}>{e.source === "none" ? "❌ لا شيء" : ORDER[e.source] ?? e.source}</td>
                <td>{(e.ms / 1000).toFixed(1)}ث</td>
                <td dir="ltr" className="text-xs text-ink-3">{e.tried.join(" → ")}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>
    </PanelShell>
  );
}
