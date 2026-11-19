/** Admin-editable site settings (non-secret part, stored as settings.json). */
export type Bi = { ar: string; en: string };

export interface BrandSettings {
  siteName: Bi;
  tagline: Bi;
}

export interface TextSettings {
  heroBadge: Bi;
  heroTitle1: Bi;
  heroTitle2: Bi;
  heroSubtitle: Bi;
  footerDisclaimer: Bi;
  footerRights: Bi;
  footerCredit: string;
  banner: Bi;
  bannerEnabled: boolean;
  bannerLink: string;
}

export interface SeoSettings {
  defaultTitle: string;
  titleTemplate: string;
  homeTitle: string;
  description: string;
  keywords: string[];
  googleVerification: string;
  bingVerification: string;
  robotsIndex: boolean;
  twitterHandle: string;
}

export interface FeatureSettings {
  tiktok: boolean;
  instagram: boolean;
  followers: boolean;
  following: boolean;
  stories: boolean;
  downloads: boolean;
  region: boolean;
  posts: boolean;
  search: boolean;
  analytics: boolean;
  pro: boolean;
  demoMode: "" | "auto" | "on" | "off";
  prices: { proMonthly: number; proYearly: number; bizMonthly: number; bizYearly: number };
  starPrices: { proMonthly: number; proYearly: number; bizMonthly: number; bizYearly: number };
}

export interface ThemeSettings {
  accentPrimary: string;
  accentSecondary: string;
  defaultTheme: "system" | "light" | "dark";
}

/** Uploaded images stored next to settings.json (assets/<file>). */
export interface AssetSettings {
  favicon: string;
  ogImage: string;
  heroImage: string;
}

/** Numeric knobs: list sizes, cache TTLs (minutes) and per-IP rate limits (requests/minute). */
export interface LimitSettings {
  followersShow: number;
  profileCacheMin: number;
  postsCacheMin: number;
  storiesCacheMin: number;
  regionCacheMin: number;
  apiPerMin: number;
  downloadPerMin: number;
  streamPerMin: number;
}

export interface MaintenanceSettings {
  enabled: boolean;
  message: Bi;
}

/** Analytics / verification snippets injected into <head>. */
export interface HeadSettings {
  gaId: string;
  customHead: string;
}

export interface ContactSettings {
  email: string;
  x: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  telegram: string;
  whatsapp: string;
  snapchat: string;
}

/** Markdown overrides for static pages (empty = built-in text). */
export interface PagesSettings {
  about: Bi;
  privacy: Bi;
  terms: Bi;
  refund: Bi;
  contact: Bi;
}

export interface BlogSettings {
  enabled: boolean;
  hidden: string[];
}

export interface SiteSettings {
  version: number;
  updatedAt: string;
  /** Cloudflare Worker base URL (RELAY_URL). Empty = use the Render env value. */
  relayUrl: string;
  brand: BrandSettings;
  texts: TextSettings;
  seo: SeoSettings;
  features: FeatureSettings;
  theme: ThemeSettings;
  assets: AssetSettings;
  limits: LimitSettings;
  maintenance: MaintenanceSettings;
  head: HeadSettings;
  contact: ContactSettings;
  pages: PagesSettings;
  blog: BlogSettings;
}

export type SettingsSection = "brand" | "texts" | "seo" | "features" | "theme" | "assets" | "relay" | "limits" | "maintenance" | "head" | "contact" | "pages" | "blog";
