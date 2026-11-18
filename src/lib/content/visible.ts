import { ARTICLES, articleBySlug, type Article } from "./blog";
import { PAGES } from "./pages";
import { siteNow } from "../site/snapshot";
import type { Locale } from "../i18n";

/** Articles not hidden from the admin panel (empty when the blog is switched off). */
export function visibleArticles(): Article[] {
  const b = siteNow().blog;
  if (b && b.enabled === false) return [];
  const hidden = new Set(b?.hidden ?? []);
  return ARTICLES.filter((a) => !hidden.has(a.slug));
}

export const blogEnabled = () => siteNow().blog?.enabled !== false;

export function visibleArticle(slug: string): Article | undefined {
  const a = articleBySlug(slug);
  return a && visibleArticles().some((x) => x.slug === a.slug) ? a : undefined;
}

export type PageKey = "about" | "privacy" | "terms" | "refund" | "contact";

/** Static page body: admin override (Markdown) or the built-in text. */
export function pageBody(key: PageKey, locale: Locale): string {
  const o = siteNow().pages?.[key]?.[locale]?.trim();
  return o || PAGES[key].body[locale];
}
