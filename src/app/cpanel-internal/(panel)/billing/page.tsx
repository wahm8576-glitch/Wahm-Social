import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection, Section } from "@/components/admin/Section";
import { Text, Select, Toggle, Submit } from "@/components/admin/Fields";
import { Users, Payments } from "@/lib/server/db";
import { billingMode } from "@/lib/env";
import { planOf } from "@/lib/plans";

export const dynamic = "force-dynamic";

function fmt(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

export default async function BillingAdminPage({ searchParams }: { searchParams: Flashy & { email?: string } }) {
  const { base } = await guardPage();
  const email = (searchParams.email ?? "").trim().toLowerCase();
  const user = email ? Users.byEmail(email) : undefined;
  const payments = user ? Payments.forUser(user.id).slice(-8).reverse() : [];
  const mode = billingMode();
  return (
    <PanelShell active="billing" title="الدفع والاشتراكات" flash={searchParams}>
      <Section title="الحالة" desc="الموفّرون: PayPal ونجوم Telegram (@PaySubStarsBot). الوضع التجريبي (ترقية مجانية بضغطة) يعمل فقط على جهاز التطوير، ومقفول في الإنتاج إذا ما انضبطت المفاتيح.">
        <p className="text-sm text-ink-2">
          وضع الدفع الحالي: <span dir="ltr" className="font-mono font-bold text-ink">{mode}</span>
        </p>
      </Section>
      <Section title="🔍 البحث عن مستخدم" desc="أدخل بريد أي حساب لعرض خطته الحالية وتاريخ الانتهاء، ثم فعّل أو مدّد أو ألغِ الاشتراك مباشرة.">
        <form method="get" action={`${base}/billing`} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Text name="email" label="البريد الإلكتروني" value={email} dir="ltr" placeholder="user@example.com" />
          </div>
          <button type="submit" className="btn-primary">
            بحث
          </button>
        </form>
        {email && !user && <p className="mt-3 text-sm text-amber-600 dark:text-amber-300">ما فيه حساب بهذا البريد.</p>}
        {user && (
          <div className="mt-4 space-y-1 rounded-xl border border-line bg-surface/40 p-4 text-sm text-ink-2">
            <p>
              <span className="text-ink-4">الاسم: </span>
              {user.name || "—"}
            </p>
            <p dir="ltr">
              <span className="text-ink-4">email: </span>
              {user.email}
            </p>
            <p>
              <span className="text-ink-4">الخطة الحالية: </span>
              <strong className="text-ink">{planOf(user.plan).name.ar}</strong> ({user.plan})
            </p>
            <p>
              <span className="text-ink-4">ينتهي / يتجدد: </span>
              {user.plan !== "free" && user.planRenewsAt ? (
                <>
                  {fmt(user.planRenewsAt)}{" "}
                  <span className="text-ink-4">(توقيت آسيا/الرياض)</span>
                  {user.planRenewsAt < Date.now() ? " — منتهي" : ""}
                </>
              ) : (
                "—"
              )}
            </p>
            {user.paypalSubscriptionId && (
              <p dir="ltr">
                <span className="text-ink-4">PayPal subscription: </span>
                {user.paypalSubscriptionId}
              </p>
            )}
            {user.telegramUserId ? (
              <p dir="ltr">
                <span className="text-ink-4">Telegram user id: </span>
                {user.telegramUserId}
              </p>
            ) : null}
          </div>
        )}
      </Section>
      {user && (
        <FormSection
          title="⚙️ تفعيل أو تمديد أو إلغاء"
          desc="الخطة المجانية تلغي الاشتراك فوراً. لبرو أو أعمال اختر المدة (شهر، سنة، أيام، أو حتى تاريخ). خيار التمديد يضيف المدة فوق تاريخ الانتهاء الحالي إذا كان ساري."
          action={`${base}/api/billing`}
        >
          <input type="hidden" name="email" value={user.email} />
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              name="plan"
              label="الخطة"
              value={user.plan}
              options={[
                ["pro", "برو (Pro)"],
                ["business", "أعمال (Business)"],
                ["free", "مجاني — إلغاء الاشتراك"],
              ]}
            />
            <Select
              name="duration"
              label="المدة"
              value="month"
              options={[
                ["month", "شهر (30 يوم)"],
                ["year", "سنة (365 يوم)"],
                ["days", "أيام مخصصة"],
                ["until", "حتى تاريخ معيّن"],
              ]}
            />
            <Text name="days" label="عدد الأيام (إذا اخترت أيام مخصصة)" dir="ltr" type="number" placeholder="90" />
            <Text name="until" label="حتى تاريخ (YYYY-MM-DD) — نهاية اليوم بتوقيت آسيا/الرياض" dir="ltr" type="date" />
          </div>
          <Toggle name="extend" label="تمديد من تاريخ الانتهاء الحالي" checked={false} hint="إذا الخطة الحالية سارية، تُضاف المدة الجديدة فوق تاريخ انتهائها بدل البدء من الآن." />
          <Submit label="تطبيق" />
        </FormSection>
      )}
      {user && (
        <Section title="آخر المدفوعات">
          {payments.length ? (
            <table className="w-full text-sm">
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-line">
                    <td className="py-2 text-ink-2">{fmt(p.createdAt)}</td>
                    <td className="py-2 text-ink">{p.plan}</td>
                    <td className="py-2 text-ink-2" dir="ltr">
                      {p.currency === "XTR" ? `${p.amount} ⭐` : `$${p.amount}`} / {p.interval}
                    </td>
                    <td className="py-2 text-ink">{p.provider}{p.status === "refunded" ? " (مسترجع)" : ""}</td>
                    <td className="py-2">
                      {p.provider === "telegram_stars" && p.status === "paid" && p.providerRef && (
                        <form method="post" action={`${base}/api/billing`}>
                          <input type="hidden" name="email" value={user.email} />
                          <input type="hidden" name="op" value="refund_stars" />
                          <input type="hidden" name="paymentId" value={p.id} />
                          <button type="submit" className="btn-ghost btn-sm">
                            استرجاع النجوم
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-ink-4">لا توجد مدفوعات بعد.</p>
          )}
        </Section>
      )}
    </PanelShell>
  );
}
