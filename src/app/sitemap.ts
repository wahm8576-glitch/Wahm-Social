import type { MetadataRoute } from "next";
import { absUrl } from "@/lib/seo";
import { blogEnabled, visibleArticles } from "@/lib/content/visible";
import { FEATURED } from "@/lib/content/featured";
import { TOOLS } from "@/lib/content/pages";
import { Searches } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPaths = ["/", "/explore", "/download", "/stories", "/analytics", "/compare", "/watchlist", "/pricing", "/blog", "/docs", "/api-docs", "/about", "/privacy", "/terms", "/refund", "/contact"].filter((p) => p !== "/blog" || blogEnabled());
  const profiles = new Map<string, string>();
  FEATURED.forEach((f) => profiles.set(`${f.platform}/${f.username}`, `/${f.platform}/${f.username}`));
  Searches.trending(200).forEach((s) => profiles.set(`${s.platform}/${s.username}`, `/${s.platform}/${s.username}`));
  return [
    ...staticPaths.map((p) => ({ url: absUrl(p), lastModified: now, changeFrequency: "daily" as const, priority: p === "/" ? 1 : 0.8 })),
    ...Object.keys(TOOLS).map((s) => ({ url: absUrl(`/tools/${s}`), lastModified: now, changeFrequency: "weekly" as const, priority: 0.9 })),
    ...visibleArticles().map((a) => ({ url: absUrl(`/blog/${a.slug}`), lastModified: new Date(a.date), changeFrequency: "monthly" as const, priority: 0.6 })),
    ...[...profiles.values()].flatMap((p) => [
      { url: absUrl(p), lastModified: now, changeFrequency: "daily" as const, priority: 0.7 },
      { url: absUrl(`${p}/analytics`), lastModified: now, changeFrequency: "daily" as const, priority: 0.5 },
    ]),
  ];
}
