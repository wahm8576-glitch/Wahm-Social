import type { SiteSettings } from "../site/types";
import { isHexColor } from "../site/themeCss";
import { validateRelayUrl } from "../server/relay";
import { bi, bool, lines, num, str } from "./formRead";
import { EXTRA_PARSERS } from "./sections-extra";

/** Form → settings mutators, one per panel section. */
export const SECTION_PARSERS: Record<string, (s: SiteSettings, f: FormData) => SiteSettings> = {
  texts(s, f) {
    s.brand.siteName = bi(f, "siteName", 80);
    s.brand.tagline = bi(f, "tagline", 400);
    const t = s.texts;
    t.heroBadge = bi(f, "heroBadge", 200);
    t.heroTitle1 = bi(f, "heroTitle1", 200);
    t.heroTitle2 = bi(f, "heroTitle2", 200);
    t.heroSubtitle = bi(f, "heroSubtitle", 800);
    t.footerDisclaimer = bi(f, "footerDisclaimer", 400);
    t.footerRights = bi(f, "footerRights", 200);
    t.footerCredit = str(f, "footerCredit", 200);
    return s;
  },
  banner(s, f) {
    s.texts.banner = bi(f, "banner", 300);
    s.texts.bannerEnabled = bool(f, "bannerEnabled", s.texts.bannerEnabled);
    const link = str(f, "bannerLink", 500);
    s.texts.bannerLink = /^(https?:\/\/|\/)/.test(link) ? link : "";
    return s;
  },
  seo(s, f) {
    const x = s.seo;
    x.defaultTitle = str(f, "defaultTitle", 200);
    const tpl = str(f, "titleTemplate", 200);
    x.titleTemplate = tpl.includes("%s") ? tpl : "%s";
    x.homeTitle = str(f, "homeTitle", 300);
    x.description = str(f, "description", 600);
    x.keywords = lines(f, "keywords");
    x.googleVerification = str(f, "googleVerification", 200).replace(/[^\w.-]/g, "");
    x.bingVerification = str(f, "bingVerification", 200).replace(/[^\w.-]/g, "");
    x.robotsIndex = bool(f, "robotsIndex", x.robotsIndex);
    x.twitterHandle = str(f, "twitterHandle", 40);
    return s;
  },
  features(s, f) {
    const x = s.features;
    for (const k of ["tiktok", "instagram", "followers", "following", "stories", "downloads", "region", "posts", "search", "analytics", "pro"] as const) x[k] = bool(f, k, x[k]);
    if (!x.tiktok && !x.instagram) x.tiktok = true;
    const dm = str(f, "demoMode", 10);
    x.demoMode = dm === "auto" || dm === "on" || dm === "off" ? dm : "";
    x.prices = {
      proMonthly: num(f, "proMonthly", x.prices.proMonthly),
      proYearly: num(f, "proYearly", x.prices.proYearly),
      bizMonthly: num(f, "bizMonthly", x.prices.bizMonthly),
      bizYearly: num(f, "bizYearly", x.prices.bizYearly),
    };
    x.starPrices = {
      proMonthly: Math.round(num(f, "starProMonthly", x.starPrices?.proMonthly ?? 0)),
      proYearly: Math.round(num(f, "starProYearly", x.starPrices?.proYearly ?? 0)),
      bizMonthly: Math.round(num(f, "starBizMonthly", x.starPrices?.bizMonthly ?? 0)),
      bizYearly: Math.round(num(f, "starBizYearly", x.starPrices?.bizYearly ?? 0)),
    };
    return s;
  },
  relay(s, f) {
    const v = str(f, "relayUrl", 500);
    if (v) {
      const bad = validateRelayUrl(v);
      if (bad) throw new Error(bad);
    }
    s.relayUrl = v;
    return s;
  },
  theme(s, f) {
    if (f.get("reset") === "on") {
      s.theme.accentPrimary = "";
      s.theme.accentSecondary = "";
    } else {
      const p = str(f, "accentPrimary", 7);
      const q = str(f, "accentSecondary", 7);
      s.theme.accentPrimary = isHexColor(p) ? p : "";
      s.theme.accentSecondary = isHexColor(q) ? q : "";
    }
    const d = str(f, "defaultTheme", 10);
    s.theme.defaultTheme = d === "light" || d === "dark" ? d : "system";
    return s;
  },
};

Object.assign(SECTION_PARSERS, EXTRA_PARSERS);

export const SECTION_PAGE: Record<string, string> = {
  texts: "texts",
  banner: "texts",
  seo: "seo",
  features: "features",
  theme: "theme",
  relay: "proxy",
  limits: "limits",
  maintenance: "site",
  head: "site",
  contact: "site",
  pages: "content",
  blog: "content",
};
