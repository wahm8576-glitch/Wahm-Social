import "server-only";
import { DISABLED_MSG, featureOn, requireFeatureOn } from "../site/flags";
/**
 * Platform service: the only entry point UI/API code should use.
 * Adds caching, demo fallback, and source labelling on top of raw adapters.
 */
import { env } from "../env";
import { cache, cached, cachedSwr, TTL } from "../server/cache";
import { loadLastGood, saveLastGood } from "../server/lastGood";
import { instagram } from "./instagram/adapter";
import { tiktok } from "./tiktok/adapter";
import { demoPosts, demoProfile, demoStories } from "./demo";
import { hasTikTokSession } from "./tiktok/session";
import { browserList } from "./tiktok/followers/browser";
import { tiktokStories } from "./tiktok/adapter";
import { connectionsFor } from "./connections";
import { lockedResult } from "./connections/visibility";
import { followersShow } from "./connections/show";
import { PlatformError, type ConnectionsResult, type DataSource, type Platform, type PlatformAdapter, type Post, type Profile, type Story } from "./types";

export * from "./types";

const adapters: Record<Platform, PlatformAdapter> = { tiktok, instagram };
export const adapter = (p: Platform) => adapters[p];

export interface Sourced<T> {
  data: T;
  source: DataSource;
  notice?: string;
}

const DEMO_NOTICE =
  "المنصة تحجب الطلبات من السيرفر حالياً — نعرض بيانات تجريبية. Platform is blocking server requests right now; showing demo data.";

/**
 * Instagram never silently swaps in demo data when it blocks us (only DEMO_MODE=on shows demo):
 * visitors get an honest "Instagram is blocking the server right now" message instead.
 */
async function withFallback<T>(key: string, ttl: number, live: () => Promise<T>, demo: () => T, autoDemo = process.env.DEMO_AUTO === "1"): Promise<Sourced<T>> {
  if (env.demoMode === "on") return { data: demo(), source: "demo", notice: DEMO_NOTICE };
  try {
    const [data, fromCache] = await cached(key, ttl, live);
    return { data, source: fromCache ? "cache" : "live" };
  } catch (e) {
    if (autoDemo && env.demoMode === "auto" && e instanceof PlatformError && (e.code === "blocked" || e.code === "upstream_error")) {
      return { data: demo(), source: "demo", notice: DEMO_NOTICE };
    }
    throw e;
  }
}

const STALE_NOTICE =
  "المصادر بطيئة أو محجوبة الحين — نعرض آخر بيانات حقيقية محفوظة وتتحدث تلقائياً. Sources are slow or blocked right now — showing the last real data we have; it refreshes automatically.";

/**
 * Profiles never fall back to fake demo data (only DEMO_MODE=on shows demo). Order:
 * fresh cache → live sources (proxy → direct → Worker, several providers) → in-memory last good
 * (served after a few seconds while the live call keeps refreshing) → Firestore last good → honest error.
 */
export async function getProfile(platform: Platform, username: string): Promise<Sourced<Profile>> {
  if (env.demoMode === "on") return { data: demoProfile(platform, username), source: "demo", notice: DEMO_NOTICE };
  const key = `profile:${platform}:${username}:v3`;
  try {
    const [data, fromCache, isStale] = await cachedSwr(key, TTL.profile, async () => {
      const p = await adapters[platform].getProfile(username);
      saveLastGood(key, p);
      return p;
    });
    return { data, source: fromCache ? "cache" : "live", ...(isStale ? { notice: STALE_NOTICE } : {}) };
  } catch (e) {
    if (e instanceof PlatformError && (e.code === "blocked" || e.code === "upstream_error")) {
      const saved = await loadLastGood<Profile>(key);
      if (saved) {
        cache.set(`stale:${key}`, saved.value, TTL.stale);
        return { data: saved.value, source: "cache", notice: STALE_NOTICE };
      }
    }
    throw e;
  }
}

const IG_POSTS_NOTICE =
  "انستقرام يحد عرض المنشورات من السيرفر حالياً — نعرض معلومات الحساب العامة فقط. الصق رابط أي منشور في مركز التحميل لتحميله. Instagram is limiting post listings from our server; showing the public profile only — paste a post link in the Download center to save it.";

export async function getPosts(platform: Platform, username: string, limit = 12): Promise<Sourced<Post[]>> {
  if (!featureOn("posts")) return { data: [], source: "live", notice: DISABLED_MSG.posts };
  if (platform === "instagram" && env.demoMode !== "on") {
    try {
      const [data, fromCache] = await cached(`posts:${platform}:${username}:${limit}`, TTL.posts, () => adapters.instagram.getPosts(username, { limit }));
      return { data, source: fromCache ? "cache" : "live" };
    } catch (e) {
      if (!(e instanceof PlatformError) || (e.code !== "blocked" && e.code !== "upstream_error")) throw e;
      const prof = await getProfile(platform, username).catch(() => null);
      if (prof && prof.source !== "demo") return { data: [], source: "live", notice: IG_POSTS_NOTICE };
      throw e;
    }
  }
  return withFallback(
    `posts:${platform}:${username}:${limit}`,
    TTL.posts,
    async () => {
      const posts = await adapters[platform].getPosts(username, { limit });
      if (platform !== "tiktok") return posts;
      const enriched = await tiktok.enrich(posts, Math.min(limit, 12));
      await repairTikTokCountry(username, enriched).catch(() => undefined);
      return enriched;
    },
    () => demoPosts(platform, username, limit),
  );
}

/**
 * The posts tab reads each video page (with locationCreated). If the profile was cached without a
 * country (its own sampling timed out / was blocked), fill it in from these posts so the next view shows it.
 */
async function repairTikTokCountry(username: string, posts: Post[]) {
  if (!featureOn("region") || !posts.some((p) => p.location?.country)) return;
  const { locationFromPosts } = await import("./tiktok/region");
  for (const key of [`profile:tiktok:${username}:v3`, `stale:profile:tiktok:${username}:v3`]) {
    const prof = cache.get<Profile>(key);
    if (!prof || prof.location?.current || prof.isPrivate) continue;
    const loc = locationFromPosts(posts, prof.language ?? prof.location?.language);
    if (!loc) continue;
    cache.set(key, { ...prof, location: loc }, key.startsWith("stale:") ? TTL.stale : TTL.profile);
    cache.set(`tt-loc:${username.toLowerCase()}`, loc, TTL.profile);
  }
}

export async function getPost(platform: Platform, ref: string, username?: string): Promise<Sourced<Post>> {
  const [data, fromCache] = await cached(`post:${platform}:${ref}`, TTL.post, () => adapters[platform].getPost(ref, username));
  return { data, source: fromCache ? "cache" : "live" };
}

/** Comments load separately so a blocked comments endpoint never prevents the post from appearing. */
export async function getPostComments(platform: Platform, ref: string, username?: string) {
  const post = await getPost(platform, ref, username);
  const key = `post-comments:${platform}:${post.data.id}:v1`;
  const [data, fromCache] = await cached(key, 10 * 60_000, () => adapters[platform].getComments(post.data));
  return { data, source: fromCache ? "cache" as const : "live" as const };
}

const IG_STORIES_NOTICE =
  "انستقرام رفض طلب الستوري من السيرفر الحين (حظر/حد طلبات على البروكسي أو الجلسة تحتاج تسجيل دخول جديد). ما نعرض بيانات وهمية — جرّب بعد شوي. Instagram refused the story request from our server (proxy rate-limited or the session needs re-login). No fake data is shown — try again shortly.";

const TIKWM_BLOCKED_NOTICE =
  "مصدر الستوري الاحتياطي (tikwm) محجوب من عنوان السيرفر حالياً. أضف مسار Worker في RELAY_URL أو بروكسي سكني في SCRAPER_PROXY ثم أعد المحاولة. The tikwm stories fallback is blocked from this server IP — set RELAY_URL or a residential proxy in SCRAPER_PROXY and try again.";

const TIKWM_QUOTA_NOTICE =
  "tikwm وصلت حدّها اليومي المجاني، فما نقدر نجيب الستوريات الحين. جرّب لاحقاً بعد ما يتجدد العداد. The tikwm free daily quota is exhausted; stories will return when it resets."

export async function getStories(platform: Platform, username: string): Promise<Sourced<Story[]>> {
  if (!featureOn("stories")) return { data: [], source: "live", notice: DISABLED_MSG.stories };
  if (platform === "tiktok" && env.demoMode !== "on") {
    try {
      const [payload, fromCache] = await cached(`stories:${platform}:${username}:v3`, TTL.stories, async () => {
        const r = await tiktokStories(username);
        return { items: r.items, note: r.note };
      });
      const notice =
        payload.note === "tikwm_quota"
          ? TIKWM_QUOTA_NOTICE
          : payload.note === "tikwm_blocked" || payload.note === "tikwm_error"
            ? TIKWM_BLOCKED_NOTICE
            : undefined;
      return { data: payload.items, source: fromCache ? "cache" : "live", notice };
    } catch (e) {
      if (e instanceof PlatformError && (e.code === "blocked" || e.code === "upstream_error")) {
        return { data: [], source: "live", notice: TIKWM_BLOCKED_NOTICE };
      }
      throw e;
    }
  }
  if (platform === "instagram" && env.demoMode !== "on") {
    try {
      const [data, fromCache] = await cached(`stories:${platform}:${username}`, TTL.stories, () => adapters.instagram.getStories(username));
      return { data, source: fromCache ? "cache" : "live" };
    } catch (e) {
      if (e instanceof PlatformError && (e.code === "blocked" || e.code === "upstream_error")) {
        return { data: [], source: "live", notice: IG_STORIES_NOTICE };
      }
      throw e;
    }
  }
  return withFallback(`stories:${platform}:${username}`, TTL.stories, () => adapters[platform].getStories(username), () => demoStories(platform, username));
}

/** Followers/following honouring each account's own privacy (see connections/index.ts). */
export async function getConnections(platform: Platform, username: string, kind: "followers" | "following", cursor?: string): Promise<Sourced<ConnectionsResult>> {
  requireFeatureOn(kind);
  const p = await getProfile(platform, username);
  if (p.source === "demo") {
    // Profile scrape blocked — but a logged-in TikTok browser session can still open the public list.
    if (platform === "tiktok" && hasTikTokSession()) {
      try {
        const br = await browserList(username, kind);
        if (br.items.length) {
          return {
            data: {
              available: true,
              visibility: "public",
              total: kind === "followers" ? p.data.followers : p.data.following,
              items: br.items.slice(0, followersShow()),
              provider: "tiktok-session",
              platformUrl: p.data.profileUrl,
              attempts: [
                { method: "official_api", ok: false, note: "skipped_demo_profile" },
                { method: "session", ok: true, note: "ok" },
              ],
            },
            source: "live",
          };
        }
      } catch { /* fall through */ }
    }
    return { data: lockedResult(p.data, kind, "not_supported"), source: "demo", notice: p.notice };
  }
  return { data: await connectionsFor(p.data, kind, cursor), source: "live" };
}

/** Detect platform from a pasted URL. */
export function detectPlatform(input: string): Platform | null {
  if (/tiktok\.com/i.test(input)) return "tiktok";
  if (/instagram\.com|instagr\.am/i.test(input)) return "instagram";
  return null;
}
