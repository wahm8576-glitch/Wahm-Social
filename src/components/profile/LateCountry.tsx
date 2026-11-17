"use client";
import { useEffect, useState } from "react";
import type { ProfileLocation } from "@/lib/platforms/types";
import type { Locale } from "@/lib/i18n";
import { AccountLocation } from "./AccountLocation";

/**
 * The server answers the page without waiting long for the account country. When it was still being
 * worked out, this asks again a few times (served from cache once ready) and shows it in place.
 */
export function LateCountry({ username, fallback, locale }: { username: string; fallback?: ProfileLocation; locale: Locale }) {
  const [loc, setLoc] = useState<ProfileLocation | undefined>(fallback);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let stop = false;
    let n = 0;
    const tick = async () => {
      n++;
      try {
        const r = await fetch(`/api/profile/tiktok/${encodeURIComponent(username)}`, { cache: "no-store", headers: { "x-no-progress": "1" } });
        const j = await r.json();
        const l: ProfileLocation | undefined = j?.data?.location;
        if (!stop && l?.current) {
          setLoc(l);
          setWaiting(false);
          return;
        }
      } catch {
        /* retry */
      }
      if (!stop && n < 4) setTimeout(tick, 5000);
      else if (!stop) setWaiting(false);
    };
    const t = setTimeout(tick, 4000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [username]);
  return (
    <>
      {loc && <AccountLocation loc={loc} locale={locale} />}
      {waiting && !loc?.current && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-ink-4 sm:justify-start" aria-live="polite">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
          {locale === "ar" ? "جاري تحديد دولة الحساب…" : "Detecting account country…"}
        </div>
      )}
    </>
  );
}
