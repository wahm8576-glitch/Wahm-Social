"use client";

import { useEffect, useState } from "react";
import type { Post } from "@/lib/platforms/types";
import { downloadHref, postHref, proxied } from "@/lib/mediaUrl";
import { compact } from "@/lib/format";
import { useI18n } from "../I18nProvider";
import { PostCommentsPanel } from "../post/PostCommentsPanel";
import Link from "next/link";

export function DownloadCenter({ initialUrl = "" }: { initialUrl?: string }) {
  const { t, locale } = useI18n();
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [post, setPost] = useState<Post | null>(null);

  async function go(u = url) {
    if (!u.trim()) return;
    setBusy(true);
    setErr("");
    setPost(null);
    try {
      const res = await fetch(`/api/resolve?url=${encodeURIComponent(u.trim())}`);
      const j = await res.json();
      if (!j.ok) setErr(j.error?.message ?? t.states.error);
      else setPost(j.data.post);
    } catch {
      setErr(t.states.error);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialUrl) go(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ref = post ? (post.platform === "tiktok" ? post.id : post.shortcode ?? post.id) : "";

  return (
    <div className="mx-auto max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="card flex flex-col gap-2 p-2.5 shadow-glow sm:flex-row"
      >
        <input
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-ink placeholder:text-ink-4 focus:outline-none"
          placeholder={t.download.placeholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          dir="ltr"
          onPaste={(e) => {
            const v = e.clipboardData.getData("text");
            if (v) setTimeout(() => go(v), 0);
          }}
        />
        <button className="btn-primary px-6" disabled={busy}>
          {busy ? t.states.loading : t.download.go}
        </button>
      </form>
      {err && <p className="mt-3 text-center text-sm text-rose-400">{err}</p>}
      {post && (
        <>
          <div className="card mt-6 flex flex-col gap-5 p-5 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proxied(post.cover)} alt="" className="aspect-[3/4] w-full rounded-xl object-cover sm:w-44" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-accent-600 dark:text-accent-300" dir="ltr">
                @{post.author}
              </div>
              <p className="mt-2 line-clamp-3 text-ink">{post.caption || "—"}</p>
              <div className="mt-2 flex gap-4 text-xs text-ink-3">
                {post.stats.views !== undefined && <span>▶ {compact(post.stats.views, "en")}</span>}
                {post.stats.likes !== undefined && <span>♥ {compact(post.stats.likes, "en")}</span>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {post.media.map((m, i) => (
                  <a key={i} href={downloadHref(post.platform, ref, post.author, i)} className="btn-primary btn-sm">
                    ⬇ {m.type === "video" ? t.post.downloadVideo : t.post.downloadImage} {post.media.length > 1 ? i + 1 : ""}
                  </a>
                ))}
                {post.music?.url && (
                  <a href={downloadHref(post.platform, ref, post.author, 0, "audio")} className="btn-ghost btn-sm">
                    ♫ {t.post.downloadAudio}
                  </a>
                )}
                {post.author && (
                  <Link href={postHref(post.platform, post.author, ref)} className="btn-ghost btn-sm">
                    ⓘ
                  </Link>
                )}
              </div>
            </div>
          </div>
          <PostCommentsPanel platform={post.platform} postRef={ref} username={post.author} labels={t.post} locale={locale} />
        </>
      )}
      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        {t.download.steps.map((s, i) => (
          <div key={s} className="card p-5 text-center">
            <div className="accent-text text-3xl font-black">{i + 1}</div>
            <div className="mt-2 text-sm text-ink-2">{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
