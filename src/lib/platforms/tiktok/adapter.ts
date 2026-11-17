import "server-only";
/**
 * TikTok adapter — public logged-out web pages first, then tikwm.com
 * (and countik.com hints) as additional fallbacks. No request signing.
 * Official pages and fallbacks use RELAY_URL when set (allowlisted GET hosts).
 *  - https://www.tiktok.com/@user            (profile SSR JSON)
 *  - https://www.tiktok.com/embed/@user      (recent public videos)
 *  - https://www.tiktok.com/@user/video/:id  (post detail SSR JSON)
 *  - tikwm user/info, user/story, /api/?url=  (last resort before demo)
 */
import { cookiesFrom, extractScriptJson, httpGet, looksLikeBotWall } from "../../server/http";
import { PlatformError, type PlatformAdapter, type Post, type Profile, type Story } from "../types";
import { parseEmbedState, parseTikTokRef, parseUserDetail, parseVideoDetail } from "./parser";
import { mapLimit } from "../../server/concurrency";
import { countikLanguage } from "./countik";
import { tikwmPost, tikwmStories } from "./tikwm";
import { featureOn } from "../../site/flags";
import { cache, TTL } from "../../server/cache";
import { runSources, SourceMiss } from "../../sources/run";
import { countikSource, tiktokExists, tiktokSources } from "./sources";

const BASE = "https://www.tiktok.com";
const LOCATION_WAIT_MS = 6000;

/** Background country result → fill the cached profile so the next view shows it without waiting. */
function patchCachedProfileLocation(username: string, loc: NonNullable<Profile["location"]>) {
  for (const key of [`profile:tiktok:${username}:v3`, `stale:profile:tiktok:${username}:v3`]) {
    const prof = cache.get<Profile>(key);
    if (prof && !prof.location?.current) cache.set(key, { ...prof, location: loc }, key.startsWith("stale:") ? TTL.stale : TTL.profile);
  }
}

async function fetchProfilePage(username: string) {
  const res = await httpGet(`${BASE}/@${encodeURIComponent(username)}?lang=en`, { retries: 1 });
  if (looksLikeBotWall(res.text)) throw new PlatformError("blocked", "TikTok temporarily blocked the request", 503);
  const json = extractScriptJson(res.text, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!json) throw new PlatformError("blocked", "TikTok returned an unexpected page", 503);
  return parseUserDetail(json);
}

export async function fetchEmbed(username: string) {
  const res = await httpGet(`${BASE}/embed/@${encodeURIComponent(username)}`, { retries: 1 });
  const json = extractScriptJson(res.text, "__FRONTITY_CONNECT_STATE__");
  if (!json) return { posts: [] as Post[] };
  return parseEmbedState(json, username);
}

export async function fetchVideoPage(username: string, id: string): Promise<{ post: Post; cookie: string }> {
  const res = await httpGet(`${BASE}/@${encodeURIComponent(username || "i")}/video/${id}?lang=en`, { retries: 1 });
  if (looksLikeBotWall(res.text)) throw new PlatformError("blocked", "TikTok temporarily blocked the request", 503);
  const json = extractScriptJson(res.text, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!json) throw new PlatformError("blocked", "TikTok returned an unexpected page", 503);
  const { status, post } = parseVideoDetail(json);
  if (status !== 0 || !post) throw new PlatformError("not_found", "Video not found or not public", 404);
  return { post, cookie: cookiesFrom(res.headers) };
}

async function resolveShortUrl(url: string): Promise<{ id?: string; username?: string }> {
  const res = await httpGet(url, { retries: 0 });
  return parseTikTokRef(res.url);
}

async function enrichLanguage(profile: Profile): Promise<Profile> {
  if (profile.language || !profile.secUid) return profile;
  const language = await countikLanguage(profile.secUid).catch(() => undefined);
  return language ? { ...profile, language } : profile;
}

export const tiktok: PlatformAdapter & {
  enrich(posts: Post[], max?: number): Promise<Post[]>;
} = {
  platform: "tiktok",

  async getProfile(username) {
    let profile: Profile;
    let itemIds: string[] = [];
    let seedPosts: Post[] = [];
    try {
      const { value, source } = await runSources(`profile:tiktok:${username}`, tiktokSources(username), { staggerMs: 3000, totalMs: 16000 });
      profile = value.profile;
      // SSR itemList entries already carry locationCreated — use them directly for the country.
      seedPosts = value.items;
      itemIds = value.items.map((it) => it.id);
      if (source !== "tt-page" && !profile.secUid) {
        // Partial source: top up secUid/language from tikwm/countik in the background-friendly way (short wait).
        const extra = await Promise.race([countikSource(username).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
        if (extra) profile = { ...extra.profile, ...profile, secUid: extra.profile.secUid, language: profile.language ?? extra.profile.language, followers: extra.profile.followers || profile.followers, likes: extra.profile.likes ?? profile.likes, postsCount: profile.postsCount || extra.profile.postsCount };
      }
    } catch (e) {
      if (e instanceof SourceMiss) {
        if (e.notFound) throw new PlatformError("not_found", `@${username} was not found on TikTok`, 404);
        const exists = await tiktokExists(username);
        if (exists === false) throw new PlatformError("not_found", `@${username} was not found on TikTok`, 404);
        throw new PlatformError("blocked", "TikTok sources are temporarily unavailable", 503);
      }
      throw e;
    }

    profile = await enrichLanguage(profile);
    // Country: prefer user.region from the official page (works with zero posts), then video locations.
    // tikwm user payloads are not used as a country source.
    if (!featureOn("region")) {
      profile.location = profile.language ? { recent: [], sample: 0, language: profile.language } : undefined;
      return profile;
    }
    // Never hold the page for the country: wait at most a few seconds, then let the lookup finish in the
    // background (it caches under tt-loc:<user>, and the next view / posts tab picks it up).
    const langOnly: Profile["location"] = profile.language ? { recent: [], sample: 0, language: profile.language } : undefined;
    const locP = import("./region").then((m) => m.resolveLocation(profile!, itemIds, seedPosts)).catch(() => langOnly);
    profile.location = await Promise.race([locP, new Promise<typeof langOnly>((r) => setTimeout(() => r(langOnly), LOCATION_WAIT_MS))]);
    if (!profile.location?.current) {
      const username = profile.username;
      void locP.then((loc) => loc?.current && patchCachedProfileLocation(username, loc)).catch(() => undefined);
    }
    return profile;
  },

  async getPosts(username, opts) {
    const limit = opts?.limit ?? 12;
    const [page, embed] = await Promise.allSettled([fetchProfilePage(username), fetchEmbed(username)]);
    const fromPage = page.status === "fulfilled" ? page.value.items : [];
    if (page.status === "fulfilled" && page.value.profile?.isPrivate) {
      throw new PlatformError("private_account", "This account is private", 403);
    }
    const fromEmbed = embed.status === "fulfilled" ? embed.value.posts : [];
    const seen = new Set<string>();
    const merged = [...fromPage, ...fromEmbed].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    if (!merged.length && page.status === "rejected" && embed.status === "rejected") throw page.reason;
    return merged.slice(0, limit);
  },

  /** Fill likes/comments/shares for embed posts by reading each public video page. */
  async enrich(posts, max = 12) {
    const head = posts.slice(0, max);
    const enriched = await mapLimit(head, 4, async (p) => {
      if (p.stats.likes !== undefined) return p;
      try {
        const { post } = await fetchVideoPage(p.author, p.id);
        return { ...post, media: p.media.length ? p.media : post.media, cover: p.cover || post.cover };
      } catch {
        return p;
      }
    });
    return [...enriched, ...posts.slice(max)];
  },

  async getPost(idOrUrl, username) {
    let ref = parseTikTokRef(idOrUrl);
    if (ref.shortUrl) ref = await resolveShortUrl(ref.shortUrl);
    if (!ref.id) throw new PlatformError("invalid_input", "Paste a valid TikTok video link", 400);
    const author = ref.username ?? username ?? "i";
    try {
      const { post } = await fetchVideoPage(author, ref.id);
      return post;
    } catch (e) {
      const url = `https://www.tiktok.com/@${author}/video/${ref.id}`;
      const fb = await tikwmPost(url, author);
      if (fb.ok) return fb.data;
      throw e;
    }
  },

  async getStories(username): Promise<Story[]> {
    const fb = await tikwmStories(username);
    if (fb.ok) return fb.data;
    return [];
  }
};
