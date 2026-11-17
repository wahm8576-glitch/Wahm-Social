"use client";
import { useEffect, useState } from "react";
import { compact } from "@/lib/format";
import type { Locale } from "@/lib/i18n";

export interface StatInit {
  followers: number;
  following: number;
  likes?: number;
  postsCount: number;
}

/**
 * Profile stat cards. For Instagram the public mirrors give rounded numbers; the logged-in session
 * returns exact ones a little later, so we poll the session endpoint (and listen for the posts tab's
 * event) and swap in the exact values when they arrive — no refresh needed.
 */
export function LiveStats({
  platform,
  username,
  init,
  preview,
  locale,
  labels,
}: {
  platform: string;
  username: string;
  init: StatInit;
  preview: boolean;
  locale: Locale;
  labels: { followers: string; following: string; likes: string; posts: string };
}) {
  const [s, setS] = useState<StatInit>(init);
  const [exact, setExact] = useState(platform === "instagram" ? !preview : true);

  useEffect(() => {
    if (platform !== "instagram" || exact) return;
    let stop = false;
    const apply = (p: Partial<StatInit> & { preview?: boolean }) => {
      if (!p || stop) return;
      if (typeof p.followers === "number") setS((cur) => ({ ...cur, followers: p.followers!, following: p.following ?? cur.following, postsCount: p.postsCount ?? cur.postsCount, likes: p.likes ?? cur.likes }));
      if (p.preview === false) setExact(true);
    };
    const onEvt = (e: Event) => apply((e as CustomEvent).detail);
    window.addEventListener("ig-counts", onEvt);
    const deadline = Date.now() + 90_000;
    const tick = async () => {
      try {
        const r = await fetch(`/api/ig-session/${encodeURIComponent(username)}`, { cache: "no-store" });
        const j = await r.json();
        if (j?.profile && j.profile.preview === false) {
          apply({ ...j.profile, preview: false });
          return;
        }
      } catch {
        /* retry */
      }
      if (!stop && Date.now() < deadline) setTimeout(tick, 4000);
    };
    const to = setTimeout(tick, 3000);
    return () => {
      stop = true;
      clearTimeout(to);
      window.removeEventListener("ig-counts", onEvt);
    };
  }, [platform, username, exact]);

  const cards = [
    { label: labels.followers, value: compact(s.followers, locale) },
    { label: labels.following, value: compact(s.following, locale) },
    ...(s.likes !== undefined ? [{ label: labels.likes, value: compact(s.likes, locale) }] : []),
    { label: labels.posts, value: compact(s.postsCount, locale) },
  ];
  return (
    <div className="relative mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-line bg-glass px-4 py-3 text-center">
          <div className="text-xl font-black text-ink transition-colors">{c.value}</div>
          <div className="text-xs text-ink-3">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
