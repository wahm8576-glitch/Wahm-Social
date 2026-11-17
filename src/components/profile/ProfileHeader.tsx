import type { Profile } from "@/lib/platforms/types";
import type { Dict, Locale } from "@/lib/i18n";
import { date } from "@/lib/format";
import { Avatar, Badge, PlatformIcon, VerifiedIcon } from "../ui";
import { ProfileActions } from "./ProfileActions";
import { AccountLocation } from "./AccountLocation";
import { LateCountry } from "./LateCountry";
import { LiveStats } from "./LiveStats";

export function ProfileHeader({ p, t, locale, canPro }: { p: Profile; t: Dict; locale: Locale; canPro: boolean }) {
  return (
    <section className="card relative overflow-hidden p-6 sm:p-8">
      <div className="pointer-events-none absolute -top-24 end-0 h-64 w-64 rounded-full bg-accent-500/10 blur-3xl" />
      <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <Avatar src={p.avatarUrl} alt={p.displayName} size={128} />
        <div className="min-w-0 flex-1 text-center sm:text-start">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{p.displayName}</h1>
            {p.verified && <VerifiedIcon />}
            {p.isPrivate && <Badge tone="red">🔒 {t.profile.private}</Badge>}
            {p.isBusiness && <Badge tone="blue">{t.profile.business}</Badge>}
            {p.preview && <Badge>{locale === "ar" ? "معاينة عامة" : "Public preview"}</Badge>}
          </div>
          <div className="mt-1 flex items-center justify-center gap-2 text-ink-3 sm:justify-start" dir="ltr">
            <PlatformIcon platform={p.platform} />@{p.username}
          </div>
          {p.category && <div className="mt-1 text-sm text-accent-600 dark:text-accent-300">{p.category}</div>}
          {p.bio && <p className="mt-4 whitespace-pre-line text-sm leading-7 text-ink-2">{p.bio}</p>}
          {p.platform === "tiktok" && !p.isPrivate && !p.location?.current && (p.postsCount ?? 1) > 0 ? (
            <LateCountry username={p.username} fallback={p.location} locale={locale} />
          ) : (
            p.location && <AccountLocation loc={p.location} locale={locale} />
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-ink-4 sm:justify-start">
            {p.createdAt && (
              <span>
                {t.profile.joined} {date(p.createdAt, locale)}
              </span>
            )}
            {p.externalUrl && (
              <a href={p.externalUrl} target="_blank" rel="nofollow noopener noreferrer" className="text-sky-300 hover:underline" dir="ltr">
                {p.externalUrl.replace(/^https?:\/\//, "").slice(0, 40)}
              </a>
            )}
            <a href={p.profileUrl} target="_blank" rel="nofollow noopener noreferrer" className="text-accent-600 dark:text-accent-300 hover:underline">
              {t.profile.openOn} {p.platform === "tiktok" ? "TikTok" : "Instagram"} ↗
            </a>
          </div>
        </div>
        <ProfileActions platform={p.platform} username={p.username} canPro={canPro} />
      </div>
      <LiveStats
        platform={p.platform}
        username={p.username}
        init={{ followers: p.followers, following: p.following, likes: p.likes, postsCount: p.postsCount }}
        preview={!!p.preview}
        locale={locale}
        labels={{ followers: t.profile.followers, following: t.profile.following, likes: t.profile.likes, posts: t.profile.posts }}
      />
    </section>
  );
}
