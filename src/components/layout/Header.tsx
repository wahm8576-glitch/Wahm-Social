import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import type { SessionUser } from "@/lib/server/auth";
import { Logo } from "./Logo";
import { LangToggle } from "./LangToggle";
import { ThemeToggle } from "./ThemeToggle";
import { MobileMenu, NavLinks } from "./NavLinks";
import { ProBadge } from "../ui";
import { featureOn } from "@/lib/site/flags";

export function Header({ t, user }: { t: Dict; user: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-glass backdrop-blur-xl">
      <div className="container-w relative flex h-16 items-center justify-between gap-4">
        <Logo label={t.brand} />
        <NavLinks />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LangToggle />
          {user ? (
            <Link href="/account" className="btn-ghost btn-sm">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-gradient text-[11px] font-black text-white">
                {(user.name || user.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline">أهلاً {user.name || user.email.split("@")[0]} 👋</span>
              {user.plan !== "free" && <ProBadge label={user.plan === "business" ? "BIZ" : "PRO"} />}
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost btn-sm hidden sm:inline-flex">
                {t.nav.login}
              </Link>
              {featureOn("pro") && (
                <Link href="/pricing" className="btn-primary btn-sm">
                  {t.pro.upgrade}
                </Link>
              )}
            </>
          )}
          <MobileMenu authed={!!user} />
        </div>
      </div>
    </header>
  );
}
