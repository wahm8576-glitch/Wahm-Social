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
import { tikwmPost, tikwmStories, tikwmUser } from "./tikwm";
import { featureOn } from "../../site/flags";

const BASE = "https://www.tiktok.com";

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

function isThin(p: Profile): boolean {
  return !p.id || (!p.secUid && !p.avatarUrl && p.followers === 0 && p.postsCount === 0);
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
    let profile: Profile | undefined;
    let primaryErr: unknown;
    let itemIds: string[] = [];
    let seedPosts: Post[] = [];
    try {
      const { status, profile: p, items } = await fetchProfilePage(username);
      itemIds = items.map((it) => it.id);
      // SSR itemList entries already carry locationCreated — use them directly for the country.
      seedPosts = items;
      if (status === 10221 || status === 10202 || status === 404 || !p) {
        primaryErr = new PlatformError("not_found", `@${username} was not found on TikTok`, 404);
      } else {
        profile = p;
      }
    } catch (e) {
      primaryErr = e;
    }

    if (!profile || isThin(profile)) {
      const fb = await tikwmUser(username);
      if (fb.ok) {
        profile = profile
          ? {
              ...fb.data,
              ...profile,
              secUid: profile.secUid || fb.data.secUid,
              avatarUrl: profile.avatarUrl || fb.data.avatarUrl,
              likes: profile.likes ?? fb.data.likes,
              createdAt: profile.createdAt ?? fb.data.createdAt,
              language: profile.language ?? fb.data.language,
              hasStory: profile.hasStory || fb.data.hasStory,
            }
          : fb.data;
      } else if (!profile) {
        const blockedish =
          primaryErr instanceof PlatformError && (primaryErr.code === "blocked" || primaryErr.code === "upstream_error");
        if (primaryErr instanceof PlatformError && primaryErr.code === "not_found") throw primaryErr;
        if (blockedish || fb.note === "tikwm_blocked" || fb.note === "tikwm_error") {
          throw primaryErr instanceof PlatformError ? primaryErr : new PlatformError("blocked", "TikTok temporarily blocked the request", 503);
        }
        throw primaryErr instanceof PlatformError ? primaryErr : new PlatformError("not_found", `@${username} was not found on TikTok`, 404);
      }
    }

    profile = await enrichLanguage(profile);
    // Country: prefer user.region from the official page (works with zero posts), then video locations.
    // tikwm user payloads are not used as a country source.
    if (!featureOn("region")) {
      profile.location = profile.language ? { recent: [], sample: 0, language: profile.language } : undefined;
      return profile;
    }
    profile.location = await import("./region").then((m) => m.resolveLocation(profile!, itemIds, seedPosts)).catch(() =>
      profile!.language ? { recent: [], sample: 0, language: profile!.language } : undefined,
    );
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
