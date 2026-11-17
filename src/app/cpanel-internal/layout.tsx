import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminBase } from "@/lib/admin/path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "لوحة التحكم",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "same-origin",
};

export default function PanelRoot({ children }: { children: React.ReactNode }) {
  if (!adminBase()) notFound();
  return <div className="min-h-screen bg-hero-glow">{children}</div>;
}
