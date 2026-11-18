"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FEATURE_LABELS, PLANS, type PlanId } from "@/lib/plans";
import type { BillingMode } from "@/lib/env";
import { useI18n, useSite } from "../I18nProvider";
import { cx, ProBadge } from "../ui";

export function PricingTable({ currentPlan, billing }: { currentPlan: PlanId | null; billing: BillingMode }) {
  const { t, locale } = useI18n();
  const site = useSite();
  const router = useRouter();
  const [interval, setInterval] = useState<"month" | "year">("year");
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState("");

  async function checkout(plan: PlanId) {
    if (plan === "free") return router.push(currentPlan ? "/account" : "/register");
    if (!currentPlan) return router.push(`/register?next=/pricing`);
    setBusy(plan);
    setError("");
    const res = await fetch("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan, interval }) });
    const json = await res.json();
    setBusy(null);
    if (!json.ok) return setError(json.error?.message ?? (billing === "off" ? t.pricing.unavailable : t.states.error));
    if (json.data.mode === "mock") {
      router.push(json.data.redirect);
      router.refresh();
      return;
    }
    if (json.data.redirect) window.location.href = json.data.redirect;
  }

  if (!site.pro) return <p className="card p-6 text-center text-ink-3">{locale === "ar" ? "اشتراكات برو متوقفة مؤقتاً." : "Pro plans are temporarily unavailable."}</p>;
  return (
    <div>
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="card inline-flex p-1">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              onClick={() => setInterval(i)}
              className={cx("rounded-lg px-5 py-2 text-sm font-semibold transition", interval === i ? "bg-accent-gradient text-white" : "text-ink-2")}
            >
              {i === "month" ? t.pricing.monthly : t.pricing.yearly}
              {i === "year" && <span className="ms-2 text-[10px] opacity-80">{t.pricing.save}</span>}
            </button>
          ))}
        </div>
        {billing === "mock" && <p className="text-xs text-amber-300/80">{t.pricing.mock}</p>}
        {billing === "off" && <p className="text-sm text-amber-300/90">{t.pricing.unavailable}</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {Object.values(PLANS).map((p) => {
          const pr = site.prices;
          const price = p.id === "pro" ? (interval === "year" ? pr.proYearly : pr.proMonthly) : p.id === "business" ? (interval === "year" ? pr.bizYearly : pr.bizMonthly) : 0;
          const isCurrent = currentPlan === p.id;
          return (
            <div key={p.id} className={cx("card relative flex flex-col p-7", p.highlight && "border-accent-500/50 shadow-glow lg:-translate-y-2")}>
              {p.highlight && (
                <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-accent-gradient px-3 py-1 text-[11px] font-black text-white rtl:translate-x-1/2">
                  {t.pricing.popular}
                </span>
              )}
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-extrabold text-ink">{p.name[locale]}</h3>
                {p.id !== "free" && <ProBadge label={p.id === "business" ? "BIZ" : "PRO"} />}
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-black text-ink">${price}</span>
                {price > 0 && <span className="text-sm text-ink-3">{interval === "year" ? t.pricing.perYear : t.pricing.perMonth}</span>}
              </div>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm text-ink-2">
                <li>✓ {p.dailyLookups.toLocaleString()} {t.pricing.lookups}</li>
                <li>✓ {p.dailyDownloads.toLocaleString()} {t.pricing.downloads}</li>
                {p.watchlistSize > 0 && <li>✓ {p.watchlistSize} {t.pricing.watchSlots}</li>}
                {p.compareSlots > 0 && <li>✓ {p.compareSlots} {t.pricing.compareSlots}</li>}
                {p.batchSize > 0 && <li>✓ {p.batchSize} {t.pricing.batchSize}</li>}
                {p.features.map((f) => (
                  <li key={f}>✓ {FEATURE_LABELS[f][locale]}</li>
                ))}
              </ul>
              <button
                onClick={() => checkout(p.id)}
                disabled={isCurrent || busy !== null || (p.id !== "free" && billing === "off")}
                className={cx("mt-7 w-full", p.highlight ? "btn-primary" : "btn-ghost")}
              >
                {isCurrent ? t.pricing.current : busy === p.id ? "…" : p.id === "free" ? t.pricing.startFree : t.pricing.choose}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
