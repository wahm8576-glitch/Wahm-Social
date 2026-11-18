import type { SiteSettings } from "../site/types";
import { bi, bool, str } from "./formRead";
import { ARTICLES } from "../content/blog";

const int = (f: FormData, k: string, prev: number, min: number, max: number) => {
  const n = Number(str(f, k, 12));
  return Number.isFinite(n) && str(f, k, 12) !== "" ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : prev;
};

/** Only http(s) links or empty. */
const link = (v: string) => (/^https?:\/\/[^\s<>"']+$/i.test(v) ? v : "");

/** Form → settings mutators for the newer panel sections. */
export const EXTRA_PARSERS: Record<string, (s: SiteSettings, f: FormData) => SiteSettings> = {
  limits(s, f) {
    const l = s.limits;
    l.followersShow = int(f, "followersShow", l.followersShow, 1, 50);
    l.profileCacheMin = int(f, "profileCacheMin", l.profileCacheMin, 0.5, 1440);
    l.postsCacheMin = int(f, "postsCacheMin", l.postsCacheMin, 0.5, 1440);
    l.storiesCacheMin = int(f, "storiesCacheMin", l.storiesCacheMin, 0.5, 1440);
    l.regionCacheMin = int(f, "regionCacheMin", l.regionCacheMin, 5, 10080);
    l.apiPerMin = int(f, "apiPerMin", l.apiPerMin, 1, 10000);
    l.downloadPerMin = int(f, "downloadPerMin", l.downloadPerMin, 1, 10000);
    l.streamPerMin = int(f, "streamPerMin", l.streamPerMin, 1, 10000);
    return s;
  },
  maintenance(s, f) {
    s.maintenance.enabled = bool(f, "enabled", s.maintenance.enabled);
    s.maintenance.message = bi(f, "message", 600);
    return s;
  },
  head(s, f) {
    const ga = str(f, "gaId", 40).toUpperCase();
    if (ga && !/^(G|UA|GT|AW)-[A-Z0-9-]{4,30}$/.test(ga)) throw new Error("معرّف Google Analytics غير صالح (مثال: G-XXXXXXX)");
    s.head.gaId = ga;
    s.head.customHead = str(f, "customHead", 8000);
    return s;
  },
  contact(s, f) {
    const c = s.contact;
    const email = str(f, "email", 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("البريد غير صالح");
    c.email = email;
    for (const k of ["x", "instagram", "tiktok", "youtube", "telegram", "whatsapp", "snapchat"] as const) c[k] = link(str(f, k, 300));
    return s;
  },
  pages(s, f) {
    for (const k of ["about", "privacy", "terms", "refund", "contact"] as const) s.pages[k] = bi(f, k, 20000);
    return s;
  },
  blog(s, f) {
    s.blog.enabled = bool(f, "enabled", s.blog.enabled);
    s.blog.hidden = ARTICLES.filter((a) => f.get(`show_${a.slug}__present`) && f.get(`show_${a.slug}`) !== "on").map((a) => a.slug);
    return s;
  },
};
