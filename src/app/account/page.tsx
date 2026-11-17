import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getDict } from "@/lib/i18n/server";
import { currentUser } from "@/lib/server/auth";
import { usageSummary } from "@/lib/server/quota";
import { Payments } from "@/lib/server/db";
import { hasFeature, planOf } from "@/lib/plans";
import { date } from "@/lib/format";
import { buildMetadata } from "@/lib/seo";
import { ApiKeyButton, CancelButton, LogoutButton } from "@/components/auth/AccountActions";
import { Badge, ProBadge } from "@/components/ui";

export const metadata = buildMetadata({ title: "حسابي | Frostly", path: "/account", noindex: true });
export const dynamic = "force-dynamic";

function Meter({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = Math.min(100, (used / Math.max(1, max)) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="text-ink-3" dir="ltr">
          {used} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/5">
        <div className="h-full bg-accent-gradient" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AccountPage({ searchParams }: { searchParams: { upgraded?: string } }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");
  const { t, locale } = getDict();
  const plan = planOf(user.plan);
  const ip = (headers().get("x-forwarded-for") ?? "").split(",")[0];
  const usage = usageSummary(user, ip);
  const payments = Payments.forUser(user.id).slice(-10).reverse();
  return (
    <div className="container-w max-w-4xl py-12">
      {searchParams.upgraded && <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200">✓ Frostly {plan.name[locale]}</div>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1 text-lg font-bold text-accent-600 dark:text-accent-300">أهلاً {user.name || user.email.split("@")[0]} 👋</p>
          <h1 className="text-3xl font-extrabold text-ink">{t.account.title}</h1>
          <p className="text-ink-3" dir="ltr">
            {user.email}
          </p>
        </div>
        <div className="flex gap-2">
          <LogoutButton />
        </div>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <div className="text-sm text-ink-3">{t.account.plan}</div>
          <div className="mt-2 flex items-center gap-2 text-2xl font-black text-ink">
            {plan.name[locale]} {plan.id !== "free" && <ProBadge />}
          </div>
          {user.planRenewsAt && plan.id !== "free" && (
            <div className="mt-2 text-sm text-ink-3">
              {t.account.renews}: {date(user.planRenewsAt, locale)}
            </div>
          )}
          <div className="mt-5 flex gap-2">
            {plan.id === "free" ? (
              <Link href="/pricing" className="btn-primary">
                {t.pro.upgrade}
              </Link>
            ) : (
              <CancelButton />
            )}
          </div>
        </div>
        <div className="card space-y-4 p-6">
          <div className="text-sm text-ink-3">{t.account.usage}</div>
          <Meter used={usage.lookups.used} max={usage.lookups.max} label={t.pricing.lookups} />
          <Meter used={usage.downloads.used} max={usage.downloads.max} label={t.pricing.downloads} />
        </div>
      </div>
      <div className="card mt-4 p-6">
        <div className="mb-3 flex items-center gap-2 text-sm text-ink-3">
          {t.account.apiKey} <Badge tone="gold">Business</Badge>
        </div>
        {hasFeature(user.plan, "api_access") ? (
          <ApiKeyButton initial={user.apiKey} />
        ) : (
          <Link href="/pricing" className="text-sm text-accent-600 dark:text-accent-300 hover:underline">
            {t.pro.upgrade} →
          </Link>
        )}
      </div>
      <div className="card mt-4 p-6">
        <div className="mb-3 text-sm text-ink-3">{t.account.payments}</div>
        {payments.length ? (
          <table className="w-full text-sm">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-2 text-ink-2">{date(p.createdAt, locale)}</td>
                  <td className="py-2 text-ink">{planOf(p.plan).name[locale]}</td>
                  <td className="py-2 text-ink-2" dir="ltr">
                    ${p.amount} / {p.interval}
                  </td>
                  <td className="py-2">
                    <Badge tone={p.provider === "mock" ? "blue" : "green"}>{p.provider}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-sm text-ink-4">—</div>
        )}
      </div>
    </div>
  );
}
