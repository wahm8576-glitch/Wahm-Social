import { notFound } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { loadPosts, parseRoute } from "@/lib/server/loaders";
import { PostGrid } from "@/components/profile/PostGrid";
import { IgPostsLive } from "@/components/profile/IgPostsLive";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { EmptyState } from "@/components/ui";
import { NoticeBar } from "@/components/ui/SourceBadge";
import { BatchButton } from "@/components/download/BatchButton";
import { currentUser } from "@/lib/server/auth";
import { hasFeature } from "@/lib/plans";
import { cache as mem } from "@/lib/server/cache";
import type { Post } from "@/lib/platforms/types";

export const dynamic = "force-dynamic";

export default async function ProfilePosts({ params }: { params: { platform: string; username: string } }) {
  const r = parseRoute(params.platform, params.username);
  if (!r) notFound();
  const { t, locale } = getDict();
  const user = await currentUser();
  const canBatch = hasFeature(user?.plan, "batch_download");

  // Instagram: don't block the page on the session browser — hand off to the client poller.
  if (r.platform === "instagram") {
    const initial = mem.get<Post[]>(`posts:instagram:${r.username}:24`) ?? mem.get<Post[]>(`posts:instagram:${r.username}:12`) ?? [];
    return (
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">{t.profile.recentPosts}</h2>
          <BatchButton platform={r.platform} username={r.username} canBatch={canBatch} disabled={false} />
        </div>
        <IgPostsLive username={r.username} initial={initial} locale={locale} />
      </section>
    );
  }

  const res = await loadPosts(r.platform, r.username, 24);
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} t={t} />;
  const posts = res.value.data;
  return (
    <section>
      <NoticeBar notice={res.value.notice} />
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">
          {t.profile.recentPosts} <span className="text-sm text-ink-4">({posts.length})</span>
        </h2>
        <BatchButton platform={r.platform} username={r.username} canBatch={canBatch} disabled={res.value.source === "demo"} />
      </div>
      {posts.length ? <PostGrid posts={posts} locale={locale} /> : <EmptyState title={t.profile.noPosts} />}
    </section>
  );
}
