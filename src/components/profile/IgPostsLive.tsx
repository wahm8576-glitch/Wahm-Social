"use client";
import { useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/platforms/types";
import type { Locale } from "@/lib/i18n";
import { PostGrid } from "./PostGrid";

type State = "loading" | "ready" | "failed";

/**
 * Instagram posts load through the logged-in session browser, which can take up to ~90s on a cold
 * profile. Show a loading state and poll the session endpoint until posts arrive, then render them
 * without a refresh. The "Instagram is limiting posts" banner shows only after the session failed.
 */
export function IgPostsLive({ username, initial, locale }: { username: string; initial: Post[]; locale: Locale }) {
  const [posts, setPosts] = useState<Post[]>(initial);
  const [state, setState] = useState<State>(initial.length ? "ready" : "loading");
  const started = useRef(false);

  useEffect(() => {
    if (initial.length || started.current) return;
    started.current = true;
    let stop = false;
    const deadline = Date.now() + 90_000;
    const tick = async () => {
      try {
        const r = await fetch(`/api/ig-session/${encodeURIComponent(username)}`, { cache: "no-store" });
        const j = await r.json();
        if (stop) return;
        if (Array.isArray(j.posts) && j.posts.length) {
          setPosts(j.posts);
          setState("ready");
          window.dispatchEvent(new CustomEvent("ig-counts", { detail: j.profile }));
          return;
        }
        if (j.done || j.state === "not_configured" || j.state === "checkpoint" || j.state === "logged_out") {
          if (j.profile) window.dispatchEvent(new CustomEvent("ig-counts", { detail: j.profile }));
          // "ok with 0 posts" means the account genuinely has none; otherwise it failed.
          setState(j.state === "ok" ? "ready" : "failed");
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!stop && Date.now() < deadline) setTimeout(tick, 3500);
      else if (!stop) setState("failed");
    };
    tick();
    return () => {
      stop = true;
    };
  }, [username, initial.length]);

  const ar = locale === "ar";
  if (state === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-3" aria-live="polite">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
        <p className="text-sm">{ar ? "جاري جلب المنشورات…" : "Fetching posts…"}</p>
        <p className="text-xs text-ink-4">{ar ? "قد يستغرق لين ٩٠ ثانية لأول مرة" : "This can take up to 90s the first time"}</p>
      </div>
    );
  }
  if (state === "failed" || !posts.length) {
    return (
      <div className="rounded-xl border border-line bg-glass p-6 text-center text-sm text-ink-3">
        {ar
          ? "انستقرام يحد عرض المنشورات من السيرفر حالياً. جرّب بعد شوي، أو الصق رابط منشور في مركز التحميل."
          : "Instagram is limiting post listings from our server right now. Try again shortly, or paste a post link in the Download center."}
      </div>
    );
  }
  return <PostGrid posts={posts} locale={locale} />;
}
