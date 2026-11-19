import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection } from "@/components/admin/Section";
import { Submit } from "@/components/admin/Fields";
import { SecretField } from "@/components/admin/SecretField";
import { secretStatus } from "@/lib/admin/secretStatus";

export const dynamic = "force-dynamic";

/** Session cookies moved to the "الجلسات" page (multiple sessions with rotation). */
const SESSION_KEYS = new Set(["igSessionId", "igCsrfToken", "igDsUserId", "igMid", "igDatr", "tiktokCookie", "tiktokSessionId"]);

const GROUPS: ["tiktok" | "telegram" | "billing", string, string][] = [
  ["telegram", "⭐ نجوم Telegram — توكن البوت", "الصق توكن بوت تيليجرام (Telegram Bot Token) هنا فقط. يُحفظ مشفّراً في Firestore ويعمل فوراً بدون تعديل بيئة Render أو إعادة تشغيل. تغيير التوكن يحدّث الويب هوك والأوامر واسم البوت تلقائياً."],
  ["tiktok", "🎵 تيك توك — مفاتيح المطورين", "مفاتيح TikTok Research API (اختياري). جلسات تيك توك وانستقرام صارت في صفحة «الجلسات»."],
  ["billing", "💳 الدفع (PayPal)", "الموفّر الأساسي PayPal. اترك المفاتيح فاضية لتعطيل الدفع في الإنتاج (المحاكاة المجانية تعمل فقط على جهاز التطوير)."],
];

export default async function KeysPage({ searchParams }: { searchParams: Flashy }) {
  const { base } = await guardPage();
  return (
    <PanelShell active="keys" title="المفاتيح" flash={searchParams}>
      {GROUPS.map(([g, title, desc]) => (
        <FormSection key={g} title={title} desc={desc} action={`${base}/api/secrets?page=keys`}>
          {secretStatus(g).filter((x) => !SESSION_KEYS.has(x.def.key)).map((x) => (
            <SecretField key={x.def.key} {...x} />
          ))}
          <Submit />
        </FormSection>
      ))}
    </PanelShell>
  );
}
