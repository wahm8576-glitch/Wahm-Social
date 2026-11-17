import Link from "next/link";

export const ADMIN_TABS: [string, string][] = [
  ["", "🏠 الرئيسية"],
  ["texts", "✏️ الاسم والنصوص"],
  ["seo", "🔎 SEO والصور"],
  ["proxy", "🌐 البروكسي"],
  ["sessions", "🍪 الجلسات"],
  ["keys", "🔑 المفاتيح"],
  ["features", "🎛️ الميزات والأسعار"],
  ["limits", "⏱️ الحدود والكاش"],
  ["site", "🧩 الصيانة والتحليلات والتواصل"],
  ["email", "✉️ البريد / SMTP"],
  ["content", "📄 الصفحات والمدونة"],
  ["theme", "🎨 الألوان والثيم"],
  ["status", "🩺 الحالة والكاش"],
  ["logs", "📜 السجل"],
  ["security", "🔒 الأمان"],
];

export function AdminNav({ base, active }: { base: string; active: string }) {
  return (
    <nav className="card flex flex-wrap gap-2 p-3">
      {ADMIN_TABS.map(([k, label]) => (
        <Link
          key={k}
          href={k ? `${base}/${k}` : base}
          prefetch={false}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${active === k ? "bg-accent-500/15 text-accent-600 dark:text-accent-200" : "text-ink-3 hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
