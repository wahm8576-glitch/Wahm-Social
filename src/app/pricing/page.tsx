import { getDict } from "@/lib/i18n/server";
import { buildMetadata, jsonLdFaq } from "@/lib/seo";
import { PageHeader, Badge } from "@/components/ui";
import { PricingTable } from "@/components/pricing/PricingTable";
import { currentUser } from "@/lib/server/auth";
import { billingMode } from "@/lib/env";
import { FAQ } from "@/lib/content/faq";
import { Faq } from "@/components/content/Faq";
import { JsonLd } from "@/components/seo/JsonLd";
import { FEATURE_LABELS, PLANS, type Feature } from "@/lib/plans";

export const metadata = buildMetadata({ title: "الأسعار — فروستلي برو | Frostly Pro Pricing", path: "/pricing", description: "خطط فروستلي: مجاني، برو، وأعمال. تحميل جماعي، مقارنة، مراقبة، تحليلات متقدمة وAPI." });
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const { t, locale } = getDict();
  const user = await currentUser();
  const features = Object.keys(FEATURE_LABELS) as Feature[];
  return (
    <div className="container-w pb-10">
      <JsonLd data={jsonLdFaq(FAQ[locale])} />
      <PageHeader title={t.pricing.title} subtitle={t.pricing.subtitle} eyebrow={<Badge tone="gold">Frostly Pro</Badge>} />
      <PricingTable currentPlan={user?.plan ?? null} billing={billingMode()} />
      <div className="card mt-16 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-ink-3">
              <th className="p-4 text-start">{t.compare.metric}</th>
              {Object.values(PLANS).map((p) => (
                <th key={p.id} className="p-4 text-center text-ink">
                  {p.name[locale]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f} className="border-b border-line">
                <td className="p-4 text-ink-2">{FEATURE_LABELS[f][locale]}</td>
                {Object.values(PLANS).map((p) => (
                  <td key={p.id} className="p-4 text-center">
                    {p.features.includes(f) ? <span className="text-accent-500 dark:text-accent-400">✓</span> : <span className="text-ink-4">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="section-title mb-6 mt-16 text-center">{t.pricing.faq}</h2>
      <Faq items={FAQ[locale]} />
    </div>
  );
}
