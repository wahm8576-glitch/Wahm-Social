import type { SiteSettings } from "./types";
import { ALL_KEYWORDS } from "../seo/keywords";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";
import { DEFAULT_DESCRIPTION } from "../seo/constants";

/** Built-in values — what the site shows when nothing was changed from the admin panel. */
export const DEFAULT_SETTINGS: SiteSettings = {
  version: 1,
  updatedAt: "",
  relayUrl: "",
  brand: {
    siteName: { ar: ar.brand, en: en.brand },
    tagline: { ar: ar.tagline, en: en.tagline },
  },
  texts: {
    heroBadge: { ar: ar.hero.badge, en: en.hero.badge },
    heroTitle1: { ar: ar.hero.title1, en: en.hero.title1 },
    heroTitle2: { ar: ar.hero.title2, en: en.hero.title2 },
    heroSubtitle: { ar: ar.hero.subtitle, en: en.hero.subtitle },
    footerDisclaimer: { ar: ar.footer.disclaimer, en: en.footer.disclaimer },
    footerRights: { ar: ar.footer.rights, en: en.footer.rights },
    footerCredit: "Frostly · by Wahm (@iwahm)",
    banner: { ar: "", en: "" },
    bannerEnabled: false,
    bannerLink: "",
  },
  seo: {
    defaultTitle: "Frostly — TikTok & Instagram Downloader, Viewer & Analytics | فروستلي",
    titleTemplate: "%s",
    homeTitle: "Frostly | تحميل فيديو تيك توك بدون علامة مائية وتحميل ريلز وستوري انستقرام — TikTok & Instagram Downloader",
    description: DEFAULT_DESCRIPTION,
    keywords: ALL_KEYWORDS,
    googleVerification: "",
    bingVerification: "",
    robotsIndex: true,
    twitterHandle: "@iwahm",
  },
  features: {
    tiktok: true,
    instagram: true,
    followers: true,
    following: true,
    stories: true,
    downloads: true,
    region: true,
    posts: true,
    search: true,
    analytics: true,
    pro: true,
    demoMode: "",
    prices: { proMonthly: 7.99, proYearly: 59.99, bizMonthly: 29.99, bizYearly: 249.99 },
    starPrices: { proMonthly: 599, proYearly: 4599, bizMonthly: 2299, bizYearly: 19199 },
  },
  theme: { accentPrimary: "", accentSecondary: "", defaultTheme: "system" },
  assets: { favicon: "", ogImage: "", heroImage: "" },
  limits: {
    followersShow: 5,
    profileCacheMin: 10,
    postsCacheMin: 10,
    storiesCacheMin: 3,
    regionCacheMin: 360,
    apiPerMin: 40,
    downloadPerMin: 30,
    streamPerMin: 120,
  },
  maintenance: {
    enabled: false,
    message: {
      ar: "الموقع تحت الصيانة حالياً، نرجع لكم قريب إن شاء الله ❄️",
      en: "Frostly is under maintenance right now — we'll be back shortly ❄️",
    },
  },
  head: { gaId: "", customHead: "" },
  contact: { email: "", x: "https://x.com/iwahm", instagram: "", tiktok: "https://www.tiktok.com/@iwahm", youtube: "", telegram: "", whatsapp: "", snapchat: "" },
  pages: { about: { ar: "", en: "" }, privacy: { ar: "", en: "" }, terms: { ar: "", en: "" }, refund: { ar: "", en: "" }, contact: { ar: "", en: "" } },
  blog: { enabled: true, hidden: [] },
};

type Plain = Record<string, unknown>;
const isObj = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep-merge stored JSON over defaults, keeping only known keys with matching types. */
export function mergeSettings(base: SiteSettings, stored: unknown): SiteSettings {
  const walk = (b: unknown, s: unknown): unknown => {
    if (s === undefined || s === null) return b;
    if (Array.isArray(b)) return Array.isArray(s) ? s.filter((x) => typeof x === "string") : b;
    if (isObj(b)) {
      if (!isObj(s)) return b;
      const out: Plain = {};
      for (const k of Object.keys(b)) out[k] = walk(b[k], s[k]);
      return out;
    }
    return typeof s === typeof b ? s : b;
  };
  return walk(base, stored) as SiteSettings;
}
