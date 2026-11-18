import { getDict } from "@/lib/i18n/server";
import { PAGES } from "@/lib/content/pages";
import { buildMetadata } from "@/lib/seo";
import { StaticPage } from "@/components/content/StaticPage";
import { pageBody } from "@/lib/content/visible";

const page = PAGES["refund"];
export const metadata = buildMetadata({ title: `${page.title.ar} | ${page.title.en} — Frostly`, path: "/refund" });

export default function Page() {
  const { locale } = getDict();
  return <StaticPage title={page.title[locale]} body={pageBody("refund", locale)} />;
}

export const dynamic = "force-dynamic";
