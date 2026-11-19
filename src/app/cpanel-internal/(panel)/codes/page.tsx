import { guardPage } from "@/lib/admin/pageGuard";
import { PanelShell, type Flashy } from "@/components/admin/PanelShell";
import { FormSection, Section } from "@/components/admin/Section";
import { Text, Select, Submit } from "@/components/admin/Fields";
import { CodeRevealActions } from "@/components/admin/CodeRevealActions";
import { listBatchViews, peekReveal, searchCodes } from "@/lib/billing/codes-service";
import { ActivationBatches, ActivationCodes } from "@/lib/server/db";
import { codeStatus } from "@/lib/billing/codes";

export const dynamic = "force-dynamic";

function fmt(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

const STATUS: Record<string, string> = {
  unused: "غير مستخدم",
  used: "مستخدم",
  expired: "منتهي",
  disabled: "معطّل",
};

export default async function CodesAdminPage({ searchParams }: { searchParams: Flashy & { q?: string; reveal?: string } }) {
  const { base } = await guardPage();
  const reveal = searchParams.reveal ? peekReveal(searchParams.reveal) : undefined;
  const q = (searchParams.q ?? "").trim();
  const hits = q ? searchCodes(q) : [];
  const batches = listBatchViews();
  return (
    <PanelShell active="codes" title="أكواد التفعيل" flash={searchParams}>
      <Section title="تنبيه مهم" desc="النص الكامل للكود يظهر مرة واحدة فقط لحظة التوليد. بعد ذلك نحفظ فقط بصمة SHA/HMAC وآخر 4 أحرف. لا يمكن تصدير الأكواد غير المستخدمة لاحقاً — حمّل CSV أو TXT أو انسخها الآن.">
        <p className="text-sm text-amber-700 dark:text-amber-300">إذا أغلقت هذه الصفحة أو انتهى وقت العرض (٣٠ دقيقة) فلن نقدر نرجع النص الكامل. عطِ الأكواد لمن تريد قبل أن تختفي.</p>
      </Section>

      {reveal && (
        <Section title={`أكواد الدفعة (${reveal.codes.length})`} desc={`${reveal.plan} — ${reveal.days} يوم${reveal.label ? ` — ${reveal.label}` : ""}. حمّلها الآن.`}>
          <CodeRevealActions
            codes={reveal.codes}
            csvHref={`${base}/api/codes?reveal=${encodeURIComponent(reveal.id)}&format=csv`}
            txtHref={`${base}/api/codes?reveal=${encodeURIComponent(reveal.id)}&format=txt`}
          />
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-line bg-surface/40 p-3 font-mono text-xs text-ink dir-ltr" dir="ltr">
            {reveal.codes.join("\n")}
          </pre>
        </Section>
      )}

      <FormSection
        title="توليد دفعة أكواد"
        desc="اختر العدد (حتى 10000) والخطة والمدة. الأكواد صعبة التخمين (80 بت، Crockford، شكل FROST-XXXX-XXXX-XXXX-XXXX)."
        action={`${base}/api/codes`}
      >
        <input type="hidden" name="op" value="generate" />
        <div className="grid gap-3 md:grid-cols-2">
          <Text name="count" label="عدد الأكواد" dir="ltr" type="number" value="10" placeholder="1–10000" />
          <Select
            name="plan"
            label="الخطة"
            value="pro"
            options={[
              ["pro", "برو (Pro)"],
              ["business", "أعمال (Business)"],
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
            ]}
          />
          <Text name="days" label="عدد الأيام (إذا اخترت أيام مخصصة)" dir="ltr" type="number" placeholder="90" />
          <Text name="maxUses" label="أقصى استخدام لكل كود" dir="ltr" type="number" value="1" />
          <Text name="expiresOn" label="صلاحية الكود (اختياري) — يجب التفعيل قبل هذا التاريخ (نهاية اليوم بتوقيت آسيا/الرياض)" dir="ltr" type="date" />
          <Text name="label" label="اسم الدفعة (اختياري)" placeholder="هدايا رمضان" />
          <Text name="note" label="ملاحظة داخلية (اختياري)" placeholder="للشركاء…" />
        </div>
        <Submit label="توليد الأكواد" />
      </FormSection>

      <Section title="بحث" desc="ابحث بآخر 4 أحرف من الكود، أو بكود كامل، أو ببريد المستخدم الذي فعّله.">
        <form method="get" action={`${base}/codes`} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Text name="q" label="آخر 4 أحرف أو بريد" value={q} dir="ltr" placeholder="A9K2 أو user@example.com" />
          </div>
          <button type="submit" className="btn-primary">
            بحث
          </button>
        </form>
        {q && !hits.length && <p className="mt-3 text-sm text-ink-4">لا توجد نتائج.</p>}
        {hits.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-ink-3">
                <th className="py-2 text-start">آخر 4</th>
                <th className="py-2 text-start">الحالة</th>
                <th className="py-2 text-start">استخدام</th>
                <th className="py-2 text-start">المستخدم</th>
                <th className="py-2 text-start"></th>
              </tr>
            </thead>
            <tbody>
              {hits.map((c) => {
                const batch = ActivationBatches.byId(c.batchId);
                const st = codeStatus(c, Boolean(batch?.disabled));
                return (
                  <tr key={c.id} className="border-b border-line">
                    <td className="py-2 font-mono text-ink" dir="ltr">
                      ••••{c.last4}
                    </td>
                    <td className="py-2 text-ink-2">{STATUS[st]}</td>
                    <td className="py-2 text-ink-2" dir="ltr">
                      {c.uses}/{c.maxUses}
                    </td>
                    <td className="py-2 text-ink-2" dir="ltr">
                      {c.redemptions.map((r) => r.email).join(", ") || "—"}
                    </td>
                    <td className="py-2">
                      {st !== "disabled" && st !== "used" && (
                        <form method="post" action={`${base}/api/codes`}>
                          <input type="hidden" name="op" value="disable_code" />
                          <input type="hidden" name="codeId" value={c.id} />
                          <button type="submit" className="btn-ghost btn-sm">
                            تعطيل
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="الدفعات" desc="إحصاءات كل دفعة: الإجمالي / المستخدم / غير المستخدم / المنتهي. لا يمكن استخراج النص الكامل من هنا.">
        {batches.length ? (
          <div className="space-y-4">
            {batches.map(({ batch, stats }) => (
              <div key={batch.id} className="rounded-xl border border-line bg-surface/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {batch.label || "بدون اسم"}{" "}
                      <span className="text-xs font-normal text-ink-4" dir="ltr">
                        {batch.id}
                      </span>
                    </p>
                    <p className="text-sm text-ink-3">
                      {batch.plan} — {batch.days} يوم — أقصى استخدام {batch.maxUses} — {fmt(batch.createdAt)}
                      {batch.expiresAt ? ` — صلاحية حتى ${fmt(batch.expiresAt)}` : ""}
                      {batch.disabled ? " — معطّلة" : ""}
                    </p>
                    {batch.note && <p className="text-sm text-ink-4">{batch.note}</p>}
                    <p className="mt-2 text-sm text-ink-2">
                      الإجمالي {stats.total} · مستخدم {stats.used} · غير مستخدم {stats.unused} · منتهي {stats.expired}
                      {stats.disabled ? ` · معطّل ${stats.disabled}` : ""}
                    </p>
                  </div>
                  {!batch.disabled && (
                    <form method="post" action={`${base}/api/codes`}>
                      <input type="hidden" name="op" value="disable_batch" />
                      <input type="hidden" name="batchId" value={batch.id} />
                      <button type="submit" className="btn-ghost btn-sm">
                        تعطيل الدفعة
                      </button>
                    </form>
                  )}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-ink-3">عرض الأكواد (آخر 4 أحرف فقط)</summary>
                  <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {ActivationCodes.forBatch(batch.id).map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1">
                        <span className="font-mono" dir="ltr">
                          ••••{c.last4}
                        </span>
                        <span className="text-ink-4">
                          {STATUS[codeStatus(c, Boolean(batch.disabled))]} ({c.uses}/{c.maxUses})
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-4">ما في دفعات بعد. ولّد الدفعة الأولى من النموذج أعلاه.</p>
        )}
      </Section>
    </PanelShell>
  );
}
