import Link from "next/link";
import type { Metadata } from "next";
import { getSettings } from "@/lib/site/store";
import { DEFAULT_SETTINGS } from "@/lib/site/defaults";
import { getDict } from "@/lib/i18n/server";
import { Hero } from "@/components/content/Hero";
import { PopularSearches } from "@/components/content/PopularSearches";
import { ALL_KEYWORDS } from "@/lib/seo/keywords";
import { FeatureGrid } from "@/components/content/FeatureGrid";
import { Faq } from "@/components/content/Faq";
import { FAQ } from "@/lib/content/faq";
import { FEATURED } from "@/lib/content/featured";
import { visibleArticles } from "@/lib/content/visible";
import { Searches } from "@/lib/server/db";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildMetadata, jsonLdFaq, jsonLdSoftware } from "@/lib/seo";
import { PlatformIcon, ProBadge } from "@/components/ui";
import { PricingTable } from "@/components/pricing/PricingTable";
import { currentUser } from "@/lib/server/auth";
import { billingMode } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const d = DEFAULT_SETTINGS.seo;
  return buildMetadata({
    title: s.seo.homeTitle || d.homeTitle,
    description: s.seo.description || HOME_DESCRIPTION,
    path: "/",
    keywords: s.seo.keywords.length ? s.seo.keywords : ALL_KEYWORDS,
  });
}

const HOME_DESCRIPTION =
  "فروستلي: أسرع موقع تحميل من تيك توك بدون علامة مائية، تحميل ريلز وصور وستوري انستقرام، عرض أي حساب ومعرفة المتابعين وتحليل التفاعل مجاناً. Frostly — free TikTok downloader (no watermark, MP4/MP3), Instagram reels & story downloader, profile viewer and engagement analytics.";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { locale, t } = getDict();
  const trending = Searches.trending(10);
  const user = await currentUser();
  const faq = FAQ[locale];
  return (
    <>
      <JsonLd data={[jsonLdSoftware(), jsonLdFaq(faq)]} />
      <Hero t={t} locale={locale} trending={trending} />
      <section className="container-w">
        <div className="mx-auto grid max-w-4xl grid-cols-3 gap-4">
          {[
            ["2.4M+", t.hero.statAccounts],
            ["18M+", t.hero.statDownloads],
            ["99.9%", t.hero.statUptime],
          ].map(([v, l]) => (
            <div key={l} className="card px-3 py-5 text-center">
              <div className="accent-text text-2xl font-black sm:text-3xl">{v}</div>
              <div className="mt-1 text-xs text-ink-3">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="container-w py-12">
        <h2 className="section-title mb-8 text-center">{t.features.title}</h2>
        <FeatureGrid t={t} />
      </section>

      <section className="container-w py-12">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="section-title">{t.nav.explore}</h2>
          <Link href="/explore" className="text-sm text-accent-600 dark:text-accent-300 hover:underline">
            {locale === "ar" ? "عرض الكل ←" : "View all →"}
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FEATURED.slice(0, 8).map((f) => (
            <Link key={f.platform + f.username} href={`/${f.platform}/${f.username}`} className="card card-hover flex items-center gap-3 p-4">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-accent-600 dark:text-accent-300">
                <PlatformIcon platform={f.platform} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-ink">{f.name}</div>
                <div className="truncate text-xs text-ink-3" dir="ltr">
                  @{f.username}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="container-w py-12">
        <div className="card grid items-center gap-8 overflow-hidden p-8 md:grid-cols-2 md:p-12">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <ProBadge /> <span className="text-sm text-accent-600 dark:text-accent-300">Frostly Pro</span>
            </div>
            <h2 className="text-3xl font-black text-ink">{t.pro.lockedDesc}</h2>
            <ul className="mt-6 space-y-2 text-ink-2">
              {[t.features.batch[0], t.features.compare[0], t.features.watchlist[0], t.analytics.title, "CSV"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <span className="text-accent-500 dark:text-accent-400">✓</span> {x}
                </li>
              ))}
            </ul>
            <Link href="/pricing" className="btn-primary mt-8">
              {t.pro.upgrade}
            </Link>
          </div>
          <div className="relative hidden h-64 md:block">
            <div className="absolute inset-0 animate-floaty rounded-3xl border border-accent-500/30 bg-gradient-to-br from-surface to-surface-2 p-6 shadow-glow">
              <div className="text-sm text-ink-3">{t.analytics.engagement}</div>
              <div className="accent-text text-5xl font-black">6.8%</div>
              <svg viewBox="0 0 300 100" className="mt-6 h-24 w-full">
                <polyline fill="none" stroke="#d4a944" strokeWidth="3" points="0,80 40,70 80,74 120,50 160,56 200,30 240,36 300,10" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section className="container-w py-12">
        <h2 className="section-title mb-8 text-center">{t.nav.pricing}</h2>
        <PricingTable currentPlan={user?.plan ?? null} billing={billingMode()} />
      </section>

      {visibleArticles().length > 0 && (
      <section className="container-w py-12">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="section-title">{t.nav.blog}</h2>
          <Link href="/blog" className="text-sm text-accent-600 dark:text-accent-300 hover:underline">
            {locale === "ar" ? "كل المقالات ←" : "All articles →"}
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {visibleArticles().slice(0, 3).map((a) => (
            <Link key={a.slug} href={`/blog/${a.slug}`} className="card card-hover p-6">
              <div className="text-xs text-accent-500 dark:text-accent-400">{a.date}</div>
              <h3 className="mt-2 font-bold leading-7 text-ink">{a.title[locale]}</h3>
              <p className="mt-2 text-sm leading-7 text-ink-3">{a.excerpt[locale]}</p>
            </Link>
          ))}
        </div>
      </section>
      )}

      <section className="container-w py-12">
        <h2 className="section-title mb-8 text-center">{locale === "ar" ? "عمليات البحث الشائعة" : "Popular searches"}</h2>
        <PopularSearches locale={locale} />
      </section>

      <section className="container-w py-12">
        <h2 className="section-title mb-8 text-center">{t.pricing.faq}</h2>
        <Faq items={faq} />
      </section>
    </>
  );
}
