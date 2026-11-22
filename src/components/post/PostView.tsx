import Link from "next/link";
import type { Post } from "@/lib/platforms/types";
import type { Dict, Locale } from "@/lib/i18n";
import { compact, date, duration } from "@/lib/format";
import { downloadHref, profileHref, proxied, streamHref } from "@/lib/mediaUrl";
import { Badge, PlatformIcon } from "../ui";
import { CopyButton } from "./CopyButton";
import { PostCommentsPanel } from "./PostCommentsPanel";

export function PostView({ post, t, locale }: { post: Post; t: Dict; locale: Locale }) {
  const ref = post.platform === "tiktok" ? post.id : post.shortcode ?? post.id;
  const stats = [
    { k: t.post.views, v: post.stats.views, i: "▶" },
    { k: t.post.likes, v: post.stats.likes, i: "♥" },
    { k: t.post.comments, v: post.stats.comments, i: "💬" },
    { k: t.post.shares, v: post.stats.shares, i: "↗" },
    { k: t.post.saves, v: post.stats.saves, i: "🔖" },
  ].filter((s) => s.v !== undefined);
  const first = post.media[0];
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="card overflow-hidden p-2">
        {first?.type === "video" ? (
          <video
            src={post.platform === "tiktok" ? streamHref(post.platform, ref, post.author) : proxied(first.url)}
            poster={proxied(post.cover)}
            controls
            playsInline
            preload="metadata"
            className="aspect-[9/16] w-full rounded-xl bg-black object-contain"
          />
        ) : (
          <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto">
            {(post.media.length ? post.media : [{ type: "image" as const, url: post.cover }]).map((m, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={proxied(m.url)} alt={`${post.author} ${i + 1}`} className="w-full shrink-0 snap-center rounded-xl object-contain" />
            ))}
          </div>
        )}
      </div>
      <div>
        <Link href={profileHref(post.platform, post.author)} className="inline-flex items-center gap-2 text-sm text-accent-600 dark:text-accent-300 hover:underline">
          <PlatformIcon platform={post.platform} /> @{post.author} · {t.post.back}
        </Link>
        <p className="mt-4 whitespace-pre-line text-lg leading-8 text-ink">{post.caption || "—"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {post.createdAt && (
            <span>
              {t.post.published} {date(post.createdAt, locale)}
            </span>
          )}
          {post.duration ? <Badge>⏱ {duration(post.duration)}</Badge> : null}
          <Badge tone="gold">{post.type}</Badge>
        </div>
        {stats.length > 0 && (
          <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {stats.map((s) => (
              <div key={s.k} className="rounded-xl border border-line bg-glass px-3 py-3 text-center">
                <div className="text-lg font-black text-ink">
                  {s.i} {compact(s.v, locale)}
                </div>
                <div className="text-[11px] text-ink-3">{s.k}</div>
              </div>
            ))}
          </div>
        )}
        <PostCommentsPanel platform={post.platform} postRef={ref} username={post.author} labels={t.post} locale={locale} />
        <div className="card mt-6 p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-bold text-ink">{t.post.download}</h2>
            {post.platform === "tiktok" && <Badge tone="green">{t.post.noWatermark}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {post.media.map((m, i) => (
              <a key={i} href={downloadHref(post.platform, ref, post.author, i)} className="btn-primary" rel="nofollow">
                ⬇ {m.type === "video" ? t.post.downloadVideo : t.post.downloadImage}
                {post.media.length > 1 ? ` ${i + 1}` : ""}
              </a>
            ))}
            {post.music?.url && (
              <a href={downloadHref(post.platform, ref, post.author, 0, "audio")} className="btn-ghost" rel="nofollow">
                ♫ {t.post.downloadAudio}
              </a>
            )}
            <a href={post.url} target="_blank" rel="nofollow noopener noreferrer" className="btn-ghost">
              ↗ {t.post.openOriginal}
            </a>
            <CopyButton text={post.url} label={t.profile.copyLink} done={t.profile.copied} />
          </div>
        </div>
        {post.music && (
          <div className="mt-4 text-sm text-ink-3">
            ♫ {t.post.music}: <span className="text-ink-2">{post.music.title}</span> — {post.music.author}
          </div>
        )}
        {post.hashtags.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-bold text-ink">{t.post.hashtags}</h3>
            <div className="flex flex-wrap gap-2" dir="ltr">
              {post.hashtags.map((h) => (
                <span key={h} className="chip">
                  #{h}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
