import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import { LogoMark, Wordmark } from "./Logo";
import { siteNow } from "@/lib/site/snapshot";
import { SocialLinks } from "./SocialLinks";

export function Footer({ t }: { t: Dict }) {
  const cols: { title: string; links: [string, string][] }[] = [
    {
      title: t.brand,
      links: [
        ["/explore", t.nav.explore],
        ["/download", t.nav.download],
        ["/stories", t.nav.stories],
        ["/analytics", t.nav.analytics],
      ],
    },
    {
      title: "Pro",
      links: [
        ["/pricing", t.nav.pricing],
        ["/compare", t.nav.compare],
        ["/watchlist", t.nav.watchlist],
        ["/api-docs", t.nav.api],
      ],
    },
    {
      title: t.nav.docs,
      links: [
        ["/docs", t.nav.docs],
        ...(siteNow().blog?.enabled === false ? [] : ([["/blog", t.nav.blog]] as [string, string][])),
        ["/tools/tiktok-downloader", "TikTok Downloader"],
        ["/tools/instagram-downloader", "Instagram Downloader"],
      ],
    },
    {
      title: t.footer.about,
      links: [
        ["/about", t.footer.about],
        ["/privacy", t.footer.privacy],
        ["/terms", t.footer.terms],
        ["/refund", t.footer.refund],
        ["/contact", t.footer.contact],
      ],
    },
  ];
  return (
    <footer className="mt-24 border-t border-line bg-glass">
      <div className="container-w grid gap-10 py-14 md:grid-cols-5">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2">
            <LogoMark size={32} />
            <Wordmark />
          </div>
          <p className="mt-4 text-sm leading-7 text-ink-3">{t.tagline}</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h4 className="mb-3 text-sm font-bold text-accent-600 dark:text-accent-300">{c.title}</h4>
            <ul className="space-y-2">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-ink-3 hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {siteNow().contact && (
        <div className="container-w pb-6">
          <SocialLinks c={siteNow().contact} />
        </div>
      )}
      <div className="border-t border-line">
        <div className="container-w flex flex-col items-center justify-between gap-2 py-6 text-xs text-ink-4 sm:flex-row">
          <span>{t.footer.disclaimer}</span>
          <span>
            © {new Date().getFullYear()} {siteNow().texts.footerCredit || "Frostly"} — {t.footer.rights}
          </span>
        </div>
      </div>
    </footer>
  );
}
