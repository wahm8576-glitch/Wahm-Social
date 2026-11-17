/**
 * Instagram session status poller (used by the posts tab + live counts).
 *   GET /api/ig-session/<username>
 * Kicks the logged-in Chromium session in the background (cached 30 min, single browser) and
 * returns the current state without waiting. NOT behind the daily lookup quota — it only reports
 * progress of work that is already allowed. Never returns secrets.
 */
import { burstGuard, parseUsername } from "@/lib/server/guard";
import { handler } from "@/lib/server/respond";
import { NextResponse } from "next/server";
import { igSessionPeek, igSessionStart } from "@/lib/platforms/instagram/session/browser";
import { hasIgSession } from "@/lib/platforms/instagram/session/cookies";
import { cache } from "@/lib/server/cache";
import type { Post, Profile } from "@/lib/platforms/types";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, { params }: { params: { username: string } }) => {
  burstGuard(req, "ig-session");
  const username = parseUsername(params.username);
  if (!hasIgSession()) return NextResponse.json({ ok: true, state: "not_configured", done: true });

  igSessionStart(username);
  const snap = igSessionPeek(username);
  // Posts may also be in the shared cache (populated by a completed session run).
  const cachedPosts = cache.get<Post[]>(`posts:instagram:${username}:24`) ?? cache.get<Post[]>(`posts:instagram:${username}:12`);
  const cachedProfile = cache.get<Profile>(`profile:instagram:${username}:v3`);

  if (snap === "running" || snap === null) {
    if (cachedPosts?.length) {
      return NextResponse.json({ ok: true, state: "ok", done: true, posts: cachedPosts, profile: counts(cachedProfile) });
    }
    return NextResponse.json({ ok: true, state: snap === "running" ? "running" : "pending", done: false });
  }
  const done = true;
  return NextResponse.json({
    ok: true,
    state: snap.state,
    done,
    posts: snap.posts?.length ? snap.posts : (cachedPosts ?? []),
    profile: counts(snap.profile ?? cachedProfile),
  });
});

function counts(p?: Profile | null) {
  if (!p) return undefined;
  return { followers: p.followers, following: p.following, postsCount: p.postsCount, likes: p.likes, preview: false };
}
