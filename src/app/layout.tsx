import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { cookies, headers } from "next/headers";
import { THEME_COOKIE, themeBoot } from "@/lib/theme";
import "./globals.css";
import { getDict } from "@/lib/i18n/server";
import { dirFor } from "@/lib/i18n";
import { I18nProvider } from "@/components/I18nProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Banner } from "@/components/layout/Banner";
import { currentUser, publicUser } from "@/lib/server/auth";
import { WelcomeToast } from "@/components/auth/WelcomeToast";
import { env, telegramStarsConfigured } from "@/lib/env";
import { jsonLdOrganization, jsonLdWebsite } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { getSettings } from "@/lib/site/store";
import { siteMetadata } from "@/lib/site/metadata";
import { accentCss } from "@/lib/site/themeCss";
import { publicSite } from "@/lib/site/publicFlags";
import { HeadExtras } from "@/components/site/HeadExtras";
import { Maintenance } from "@/components/site/Maintenance";
import { NavProgress } from "@/components/layout/NavProgress";

const latin = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], variable: "--font-ar", display: "swap" });

/** Global metadata comes from admin settings (title, description, keywords, icons, OG, verification, robots). */
export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { metadataBase: new URL(env.siteUrl), ...siteMetadata(s) };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fc" },
    { media: "(prefers-color-scheme: dark)", color: "#070a16" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  const { locale, t } = getDict();
  const isPanel = headers().get("x-frostly-cp") === "1";
  const user = isPanel ? null : await currentUser();
  const theme = cookies().get(THEME_COOKIE)?.value;
  const accent = accentCss(s.theme);
  return (
    <html lang={locale} dir={dirFor(locale)} className={`${latin.variable} ${arabic.variable} ${theme === "dark" ? "dark" : ""}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot(s.theme.defaultTheme) }} />
        {accent && <style dangerouslySetInnerHTML={{ __html: accent }} />}
        {!isPanel && <HeadExtras head={s.head} />}
      </head>
      <body className="font-sans">
        <NavProgress />
        <I18nProvider locale={locale} t={t} site={publicSite(s, { stars: telegramStarsConfigured() })}>
          {isPanel ? (
            <main className="min-h-screen">{children}</main>
          ) : s.maintenance?.enabled ? (
            <Maintenance message={s.maintenance.message} locale={locale} />
          ) : (
            <>
              <JsonLd data={[jsonLdWebsite(), jsonLdOrganization()]} />
              <Banner s={s} locale={locale} />
              <Header t={t} user={user ? publicUser(user) : null} />
              {user && <WelcomeToast />}
              <main className="min-h-[60vh]">{children}</main>
              <Footer t={t} />
            </>
          )}
        </I18nProvider>
      </body>
    </html>
  );
}
