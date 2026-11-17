import "server-only";
/**
 * Account country without needing posts.
 * 1. user.region from the (anonymous) SSR profile — present for many accounts, including new ones
 * 2. Logged-in SSR of the same page
 * 3. Session-authenticated /api/user/detail/
 * 4. Per-video locationCreated — last resort when region is absent (and the account has posts)
 * Region lookups and video sampling run in parallel so we never lose the video fallback to timeouts.
 */
import type { Post, Profile, ProfileLocation } from "../types";
import { httpGet } from "../../server/http";
import { cookieValue, hasTikTokSession, tiktokWebHeaders } from "./session";
import { accountLocation } from "./location";
import { rememberedRegion } from "./followers/web";
import { summarizeLocation, voteCountry } from "./location-summary";
import { cache } from "../../server/cache";
import { siteNow } from "../../site/snapshot";

function asCountry(v: unknown): string | undefined {
  return typeof v === "string" && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : undefined;
}

let lastRegionTry: { at: string; step: string; found: boolean; keys?: string[] } | null = null;
export const regionTry = () => lastRegionTry;

async function pageRegion(username: string): Promise<string | undefined> {
  if (!hasTikTokSession()) return undefined;
  try {
    const res = await httpGet(`https://www.tiktok.com/@${encodeURIComponent(username)}?lang=en`, {
      headers: { ...tiktokWebHeaders(`https://www.tiktok.com/@${username}`), accept: "text/html" },
      retries: 0,
      timeoutMs: 10000,
    });
    const m = res.text.match(/id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) {
      lastRegionTry = { at: new Date().toISOString(), step: "page_ssr", found: false, keys: [`http_${res.status}`, `len_${res.text.length}`] };
      return undefined;
    }
    const u = JSON.parse(m[1])?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.user ?? {};
    const found = asCountry(u?.region);
    lastRegionTry = {
      at: new Date().toISOString(),
      step: "page_ssr",
      found: !!found,
      keys: Object.keys(u).filter((k) => /region|country|location|lang|commerce/i.test(k) || k === "uniqueId"),
    };
    return found;
  } catch (e) {
    lastRegionTry = { at: new Date().toISOString(), step: "page_ssr", found: false, keys: [(e as Error).message?.slice(0, 40) ?? "err"] };
    return undefined;
  }
}

async function detailRegion(username: string, secUid?: string): Promise<string | undefined> {
  if (!hasTikTokSession()) return undefined;
  const ms = cookieValue("msToken");
  const qs = new URLSearchParams({
    aid: "1988",
    app_name: "tiktok_web",
    device_platform: "web_pc",
    uniqueId: username,
    secUid: secUid ?? "",
  });
  if (ms) qs.set("msToken", ms);
  try {
    const res = await httpGet(`https://www.tiktok.com/api/user/detail/?${qs}`, {
      headers: tiktokWebHeaders(`https://www.tiktok.com/@${username}`),
      retries: 0,
      timeoutMs: 8000,
    });
    if (!res.text.trimStart().startsWith("{")) {
      // Keep earlier page_ssr diagnostic if it found keys; otherwise record this miss.
      if (!lastRegionTry?.found) lastRegionTry = { at: new Date().toISOString(), step: "user_detail", found: false, keys: [`http_${res.status}`, `len_${res.text.length}`] };
      return undefined;
    }
    const j = JSON.parse(res.text);
    const u = j?.userInfo?.user ?? j?.user ?? {};
    const found = asCountry(u?.region);
    lastRegionTry = {
      at: new Date().toISOString(),
      step: "user_detail",
      found: !!found,
      keys: Object.keys(u).filter((k) => /region|country|location|lang|commerce/i.test(k) || k === "uniqueId"),
    };
    return found;
  } catch {
    return undefined;
  }
}

const LOC_HIT_TTL = () => Math.max(5, siteNow().limits?.regionCacheMin ?? 360) * 60_000;
const LOC_MISS_TTL = 20 * 60_000;
/** Accounts that DO have posts but we could not read a country yet (timeouts / blocks): retry soon. */
const LOC_MISS_TTL_WITH_POSTS = 3 * 60_000;

/** Posts already cached by the posts tab (each carries its video's locationCreated). */
function cachedPosts(username: string): Post[] {
  const u = username.toLowerCase();
  const out: Post[] = [];
  for (const k of [`posts:tiktok:${username}:12`, `posts:tiktok:${u}:12`, `stale:posts:tiktok:${username}:12`, `stale:posts:tiktok:${u}:12`]) {
    const v = cache.get<Post[]>(k);
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
}

export async function resolveLocation(profile: Profile, itemIds: string[] = [], seedPosts: Post[] = []): Promise<ProfileLocation | undefined> {
  const key = `tt-loc:${profile.username.toLowerCase()}`;
  const hit = cache.get<ProfileLocation | null>(key);
  if (hit) return hit;
  const seed = [...seedPosts, ...cachedPosts(profile.username)];
  // A cached miss is only trusted when there is still nothing new to learn from.
  if (hit === null && !seed.some((p) => p.location?.country)) {
    return profile.language ? { recent: [], sample: 0, language: profile.language } : undefined;
  }
  const loc = await computeLocation(profile, itemIds, seed);
  const hasPosts = (profile.postsCount ?? 1) > 0 || itemIds.length > 0;
  cache.set(key, loc?.current ? loc : null, loc?.current ? LOC_HIT_TTL() : hasPosts ? LOC_MISS_TTL_WITH_POSTS : LOC_MISS_TTL);
  return loc;
}

/** Country from posts we already hold (no network). Used to repair a profile that was cached without one. */
export function locationFromPosts(posts: Post[], language?: string): ProfileLocation | undefined {
  const loc = summarizeLocation(posts.filter((p) => p?.location?.country), language);
  return loc?.current ? { ...loc, source: "video", via: "tiktok" } : undefined;
}

async function computeLocation(profile: Profile, itemIds: string[], seed: Post[] = []): Promise<ProfileLocation | undefined> {
  // Run region enrichment and video sampling together so video country isn't lost to timeouts.
  // postsCount missing (thin/fallback profile) ≠ zero posts: still sample.
  const hasPosts = (profile.postsCount ?? 1) > 0 || itemIds.length > 0 || seed.length > 0;
  // Keep every post read so far: on timeout we vote with what we have instead of dropping it all.
  const partial = new Map<string, Post>();
  const keep = (p: Post) => p?.id && p.location?.country && partial.set(p.id, p);
  const videoPromise =
    profile.isPrivate || !hasPosts
      ? Promise.resolve(undefined)
      : Promise.race([
          accountLocation(profile.username, profile.language, 12, itemIds, 14_000, seed, keep).catch(() => undefined),
          new Promise<undefined>((r) => setTimeout(() => r(undefined), 18000)),
        ]).then((v) => (v?.current ? v : summarizeLocation([...partial.values()], profile.language) ?? v));

  const regionPromise = (async () => {
    let region = profile.region ?? rememberedRegion(profile.username);
    if (region) {
      lastRegionTry = { at: new Date().toISOString(), step: profile.region ? "ssr_field" : "list_hint", found: true, keys: ["region"] };
      return region;
    }
    if (!region) region = await pageRegion(profile.username).catch(() => undefined);
    if (!region) region = await detailRegion(profile.username, profile.secUid).catch(() => undefined);
    return region;
  })();

  const [profileRegion, fromVideos] = await Promise.all([regionPromise, videoPromise]);
  let region = profileRegion;
  let regionSource: "profile" | "video" | undefined = region ? "profile" : undefined;
  let via: "tiktok" | "tikwm" | undefined;
  let sample = fromVideos?.sample ?? 0;
  let recent = fromVideos?.recent ?? [];

  if (!region && fromVideos?.current) {
    region = fromVideos.current;
    regionSource = "video";
    via = "tiktok";
  }

  // Last resort: tikwm per-video region (ids from countik + the embed). Majority vote.
  // Never invent a country for accounts with zero posts.
  if (!region && !profile.isPrivate && hasPosts) {
    const fb = await fallbackVideoRegion(profile, itemIds).catch(() => undefined);
    if (fb?.code) {
      region = fb.code;
      regionSource = "video";
      via = "tikwm";
      sample = fb.total;
      recent = fb.recent;
    }
  }

  if (region) {
    return {
      current: region,
      source: regionSource ?? "profile",
      ...(via ? { via } : {}),
      place: fromVideos?.place,
      recent: regionSource === "profile" ? recent.filter((x) => x.code !== region) : recent,
      sample,
      language: profile.language ?? fromVideos?.language,
    };
  }
  if (fromVideos?.place || fromVideos?.language) return { ...fromVideos, source: undefined };
  if (profile.language) return { recent: [], sample: 0, language: profile.language };
  return undefined;
}

async function fallbackVideoRegion(
  profile: Profile,
  itemIds: string[],
): Promise<{ code?: string; total: number; recent: { code: string; count: number }[] } | undefined> {
  const { countikVideoIds } = await import("./countik");
  const { tikwmVideo } = await import("./tikwm");
  const fromCountik = profile.secUid ? await countikVideoIds(profile.secUid).catch(() => [] as string[]) : [];
  const ids = [...new Set([...itemIds, ...fromCountik])].filter((x) => /^\d{18,21}$/.test(x)).slice(0, 5);
  if (!ids.length) return undefined;
  const codes = await Promise.all(
    ids.map((id) =>
      Promise.race([
        tikwmVideo(`https://www.tiktok.com/@${profile.username}/video/${id}`),
        new Promise<null>((r) => setTimeout(() => r(null), 9000)),
      ])
        .then((v) => (v && v.ok ? asCountry(v.data.region) : undefined))
        .catch(() => undefined),
    ),
  );
  const vote = voteCountry(codes);
  const counts = new Map<string, number>();
  codes.forEach((c) => c && counts.set(c, (counts.get(c) ?? 0) + 1));
  lastRegionTry = { at: new Date().toISOString(), step: "tikwm_video", found: !!vote.code, keys: vote.code ? ["region"] : ["no_region"] };
  return { code: vote.code, total: vote.total, recent: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })) };
}
