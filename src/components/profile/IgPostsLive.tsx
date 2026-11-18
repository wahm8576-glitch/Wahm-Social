"use client";
import { useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/platforms/types";
import type { Locale } from "@/lib/i18n";
import { PostGrid } from "./PostGrid";

type State = "loading" | "ready" | "failed";

/**
 * Instagram posts: poll the server posts API (private mobile feed first, then other sources).
 * Chromium is only a last resort on the server and is no longer kicked from this poller.
 */
export function IgPostsLive({ username, initial, locale }: { username: string; initial: Post[]; locale: Locale }) {
  const [posts, setPosts] = useState<Post[]>(initial);
  const [state, setState] = useState<State>(initial.length ? "ready" : "loading");
  const started = useRef(false);

  useEffect(() => {
    if (initial.length || started.current) return;
    started.current = true;
    let stop = false;
    const deadline = Date.now() + 45_000;
    const tick = async () => {
      try {
        const r = await fetch(`/api/posts/instagram/${encodeURIComponent(username)}?limit=12`, { cache: "no-store" });
        const j = await r.json();
        if (stop) return;
        const list = Array.isArray(j.data) ? j.data : Array.isArray(j.posts) ? j.posts : [];
        if (list.length) {
          setPosts(list);
          setState("ready");
          return;
        }
        if (r.status === 403 || j?.error?.code === "private_account" || j?.error?.code === "not_found") {
          setState("failed");
          return;
        }
      } catch {
        /* keep polling a bit — a cold search can take a few seconds */
      }
      if (!stop && Date.now() < deadline) setTimeout(tick, 2500);
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
