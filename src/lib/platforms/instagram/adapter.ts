import "server-only";
/**
 * Instagram adapter — public endpoints only.
 *  - /api/v1/users/web_profile_info/?username=  (public profile + 12 recent posts)
 *  - /p/{shortcode}/embed/captioned/              (public post media)
 *  - /api/v1/feed/reels_media/                    (public stories; needs IG_SESSIONID)
 * Instagram aggressively rate-limits datacenter IPs. Configure IG_SESSIONID
 * and/or SCRAPER_PROXY for production reliability. Private accounts are never
 * bypassed: their content is reported as locked.
 */
import { httpGet } from "../../server/http";
import { hasSession, type IgClient } from "./session/cookies";
import { igJson, type IgAttempt } from "./session/api";
import { recordIg } from "./session/diagnostics";
import { PlatformError, type PlatformAdapter, type Post, type Profile, type Story } from "../types";
import { parseEmbedHtml, parseInstagramRef, parseReelsMedia, parseWebProfile } from "./parser";
import { fetchPreview, PREVIEW_TRIES } from "./preview/fetch";
import { parseOgPost, parseOgProfile } from "./preview/parse";
import { parseV1Media, parseV1User, pickSearchUser } from "./session/v1";
import { dumporProfile, igOembed, profileFromOembed } from "./mirrors";
import { igSessionLookup } from "./session/browser";
import { NotFoundHere, runSources, SourceMiss, type Source } from "../../sources/run";

type WebProfile = NonNullable<ReturnType<typeof parseWebProfile>>;
type Lookup = { found: WebProfile } | { missing: true; attempts: IgAttempt[] } | { blocked: true; attempts: IgAttempt[] };

/** username → numeric user id, learned from any successful step (lets later calls skip the search). */
const pkCache = new Map<string, string>();

/**
 * Fallback chain (first success wins; every step is recorded for /api/health?ig=1):
 *  1. web_profile_info  — www, server session
 *  2. web_profile_info  — i.instagram.com, server session (app headers)
 *  3. web_profile_info  — www, anonymous
 *  4. search → users/{pk}/info — session (a different API family, often not throttled together)
 * All steps go through SCRAPER_PROXY when it is set. Link preview + last-good copy follow in getProfile.
 */
async function lookup(username: string): Promise<Lookup> {
  const q = encodeURIComponent(username);
  const plan: [string, IgClient][] = [];
  if (hasSession()) {
    plan.push([`https://www.instagram.com/api/v1/users/web_profile_info/?username=${q}`, "web-session"]);
    plan.push([`https://i.instagram.com/api/v1/users/web_profile_info/?username=${q}`, "app-session"]);
  }
  plan.push([`https://www.instagram.com/api/v1/users/web_profile_info/?username=${q}`, "web-anon"]);
  const attempts: IgAttempt[] = [];
  let sawEmpty = false;
  for (const [url, client] of plan) {
    const r = await igJson(url, client, `https://www.instagram.com/${q}/`);
    attempts.push(r.attempt);
    if (!r.ok) continue;
    const parsed = parseWebProfile(r.json);
    if (parsed) {
      rememberPk(username, parsed.profile.id);
      recordIg(username, attempts, "ok");
      return { found: parsed };
    }
    r.attempt.outcome = "empty";
    sawEmpty = true;
  }
  if (hasSession()) {
    const info = await infoBySearch(username, attempts);
    if (info) {
      recordIg(username, attempts, "ok");
      return { found: { profile: info, posts: [] } };
    }
  }
  return sawEmpty ? { missing: true, attempts } : { blocked: true, attempts };
}

async function infoBySearch(username: string, attempts: IgAttempt[]): Promise<Profile | null> {
  const q = encodeURIComponent(username);
  let pk = pkCache.get(username.toLowerCase());
  if (!pk) {
    const searches: [string, IgClient][] = [
      [`https://www.instagram.com/web/search/topsearch/?context=blended&query=${q}&include_reel=false`, "web-session"],
      [`https://i.instagram.com/api/v1/users/search/?q=${q}&count=10`, "app-session"],
    ];
    for (const [url, client] of searches) {
      const r = await igJson(url, client);
      attempts.push(r.attempt);
      const u = r.ok ? pickSearchUser(r.json, username) : null;
      if (u?.pk || u?.pk_id || u?.id) {
        pk = String(u.pk ?? u.pk_id ?? u.id);
        pkCache.set(username.toLowerCase(), pk);
        break;
      }
      if (r.ok) r.attempt.outcome = "empty";
    }
  }
  if (!pk) return null;
  for (const [url, client] of [
    [`https://i.instagram.com/api/v1/users/${pk}/info/`, "app-session"],
    [`https://www.instagram.com/api/v1/users/${pk}/info/`, "web-session"],
  ] as [string, IgClient][]) {
    const r = await igJson(url, client, `https://www.instagram.com/${q}/`);
    attempts.push(r.attempt);
    const p = r.ok ? parseV1User(r.json?.user) : null;
    if (p) return p;
  }
  return null;
}

/** Instagram shortcodes are base64url-encoded numeric media ids. */
function shortcodeToId(code: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = BigInt(0);
  for (const ch of code.slice(0, 11)) id = id * BigInt(64) + BigInt(alphabet.indexOf(ch));
  return id.toString();
}

/** Public oEmbed (thumbnail + author) — last resort for a post cover. */
async function oembedPost(shortcode: string): Promise<Post | null> {
  try {
    const res = await httpGet(`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(`https://www.instagram.com/p/${shortcode}/`)}`, {
      retries: 0,
      proxy: true,
      failoverOn: [429],
      headers: { accept: "application/json" },
    });
    if (res.status !== 200 || !res.text.startsWith("{")) return null;
    const j = JSON.parse(res.text) as { thumbnail_url?: string; author_name?: string; title?: string };
    if (!j.thumbnail_url) return null;
    return {
      platform: "instagram",
      id: shortcode,
      shortcode,
      author: j.author_name ?? "",
      caption: j.title ?? "",
      type: "image",
      cover: j.thumbnail_url,
      media: [{ type: "image", url: j.thumbnail_url }],
      stats: {},
      hashtags: [],
      url: `https://www.instagram.com/p/${shortcode}/`,
    };
  } catch {
    return null;
  }
}

/** Remember a numeric Instagram user id learned from any source. */
export function rememberPk(username: string, id: string | number | undefined | null) {
  const pk = String(id ?? "");
  if (/^\d{5,}$/.test(pk)) pkCache.set(username.toLowerCase(), pk);
  return pkCache.get(username.toLowerCase()) ?? null;
}

/** Resolve username → pk without waiting on Chromium. Uses cache, then mobile search. */
export async function resolvePk(username: string): Promise<string | null> {
  const hit = pkCache.get(username.toLowerCase());
  if (hit) return hit;
  try {
    const { cache } = await import("../../server/cache");
    const p = cache.get<{ id?: string }>(`profile:instagram:${username}:v3`);
    const fromProfile = rememberPk(username, p?.id);
    if (fromProfile) return fromProfile;
  } catch {
    /* cache is optional in tests */
  }
  if (!hasSession()) return null;
  const q = encodeURIComponent(username);
  const searches: [string, IgClient][] = [
    [`https://i.instagram.com/api/v1/users/search/?q=${q}&count=10`, "app-session"],
    [`https://www.instagram.com/web/search/topsearch/?context=blended&query=${q}&include_reel=false`, "web-session"],
  ];
  for (const [url, client] of searches) {
    const r = await igJson(url, client);
    const u = r.ok ? pickSearchUser(r.json, username) : null;
    const pk = rememberPk(username, u?.pk ?? u?.pk_id ?? u?.id);
    if (pk) return pk;
  }
  return pkCache.get(username.toLowerCase()) ?? null;
}

/** Recent posts via the private mobile feed API (fast; no Chromium). */
async function feedByPk(username: string, limit = 12): Promise<Post[] | null> {
  const pk = await resolvePk(username);
  if (!pk || !hasSession()) return null;
  for (const [url, client] of [
    [`https://i.instagram.com/api/v1/feed/user/${pk}/?count=${limit}`, "app-session"],
    [`https://www.instagram.com/api/v1/feed/user/${pk}/?count=${limit}`, "web-session"],
  ] as [string, IgClient][]) {
    const r = await igJson(url, client, `https://www.instagram.com/${username}/`);
    if (r.ok && Array.isArray(r.json?.items) && r.json.items.length) {
      console.info(`[instagram] @${username} posts path=${client}:feed-user result=ok n=${r.json.items.length}`);
      return r.json.items.map((it: unknown) => parseV1Media(it, username));
    }
    if (r.ok && Array.isArray(r.json?.items)) {
      console.info(`[instagram] @${username} posts path=${client}:feed-user result=empty`);
    }
  }
  return null;
}

async function webProfile(username: string): Promise<WebProfile> {
  const r = await lookup(username);
  if ("found" in r) return r.found;
  recordIg(username, r.attempts, "missing" in r ? "empty" : "blocked");
  if ("missing" in r) throw new PlatformError("not_found", `@${username} was not found on Instagram`, 404);
  throw new PlatformError(
    "blocked",
    hasSession()
      ? "Instagram rejected the server session (it may have expired or needs a security check). Showing what the public preview allows."
      : "Instagram is limiting anonymous requests from this server. Try again shortly.",
    503,
  );
}

/**
 * Public link-preview profile (name, avatar, counts). It sometimes comes back bare
 * under load, so retry; "missing" only when every attempt returned a page without a profile.
 */
async function previewProfile(username: string): Promise<Profile | "missing" | null> {
  let bare = 0;
  // Round 1 walks all unfurl agents; round 2 (after a short pause) retries the first three.
  const order = [...Array(PREVIEW_TRIES).keys(), -1, 0, 1, 2];
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    if (i === -1) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (n) await new Promise((r) => setTimeout(r, 250));
    try {
      const p = parseOgProfile(await fetchPreview(`/${encodeURIComponent(username)}/`, i), username);
      if (p) return p;
      bare++;
    } catch (e) {
      if (e instanceof PlatformError && e.code === "not_found") return "missing";
    }
    if (n === PREVIEW_TRIES - 1 && bare === PREVIEW_TRIES) return "missing";
  }
  return null;
}

/** Last good profile per username — served when Instagram temporarily blocks the server. */
const lastGood = new Map<string, { profile: Profile; at: number }>();
const remember = (p: Profile) => {
  lastGood.set(p.username.toLowerCase(), { profile: p, at: Date.now() });
  if (lastGood.size > 2000) lastGood.delete(lastGood.keys().next().value as string);
  return p;
};

/** Instagram profile sources in priority order (also used by the admin probe). */
export function instagramSources(username: string): Source<Profile>[] {
  return [
    {
      // Logged-in Chromium session: exact counts + posts. Cached 30 min and single-browser, so it
      // costs nothing on a warm cache and otherwise keeps running in the background to prime the cache.
      id: "ig-session",
      timeoutMs: 22000,
      run: async () => (await igSessionLookup(username))?.profile ?? null,
    },
    {
      id: "ig-api",
      timeoutMs: 16000,
      run: async () => {
        const r = await lookup(username);
        if ("found" in r) return r.found.profile;
        recordIg(username, r.attempts, "missing" in r ? "empty" : "blocked");
        if ("missing" in r) return null;
        throw new Error("blocked (429 / login wall)");
      },
    },
    { id: "dumpor", timeoutMs: 10000, run: () => dumporProfile(username) },
    {
      id: "ig-preview",
      timeoutMs: 12000,
      run: async () => {
        const p = await previewProfile(username);
        if (p === "missing") throw new NotFoundHere();
        return p;
      },
    },
  ];
}

export const instagram: PlatformAdapter = {
  platform: "instagram",

  async getProfile(username): Promise<Profile> {
    const sources = instagramSources(username);
    try {
      const { value, source } = await runSources(`profile:instagram:${username}`, sources, { staggerMs: 3000, totalMs: 18000 });
      let profile = value;
      if (source === "dumpor" && !profile.avatarUrl) {
        const o = await igOembed(username);
        if (o) profile = { ...profile, avatarUrl: o.avatarUrl };
      }
      return remember(profile);
    } catch (e) {
      if (!(e instanceof SourceMiss)) throw e;
      const stale = lastGood.get(username.toLowerCase());
      if (stale && Date.now() - stale.at < 24 * 3600_000) return stale.profile;
      const o = await igOembed(username);
      if (o === false || (e.notFound && !o)) throw new PlatformError("not_found", `@${username} was not found on Instagram`, 404);
      if (o) return profileFromOembed(o, username);
      throw new PlatformError(
        "blocked",
        "انستقرام يرفض الطلبات حالياً من كل المصادر (البروكسي، المباشر، والمصادر البديلة). ما نعرض بيانات وهمية — جرّب بعد دقائق. Instagram is refusing requests from every source right now. No fake data is shown — please try again in a few minutes.",
        503,
      );
    }
  },

  async getPosts(username, opts): Promise<Post[]> {
    const limit = opts?.limit ?? 12;
    // Private mobile/web feed first — Chromium is slow, often busy on Render, and can 429 the session.
    const feed = await feedByPk(username, limit).catch(() => null);
    if (feed?.length) return feed.slice(0, limit);
    try {
      const { profile, posts } = await webProfile(username);
      if (profile.isPrivate) throw new PlatformError("private_account", "This account is private", 403);
      if (posts.length) {
        console.info(`[instagram] @${username} posts path=web_profile_info result=ok n=${posts.length}`);
        return posts.slice(0, limit);
      }
    } catch (e) {
      if (e instanceof PlatformError && (e.code === "private_account" || e.code === "not_found")) throw e;
    }
    const sess = await igSessionLookup(username).catch(() => null);
    if (sess?.profile?.isPrivate) throw new PlatformError("private_account", "This account is private", 403);
    if (sess?.posts.length) {
      console.info(`[instagram] @${username} posts path=chromium result=ok n=${sess.posts.length}`);
      return sess.posts.slice(0, limit);
    }
    throw new PlatformError("blocked", "Instagram is limiting post listings from this server right now.", 503);
  },

  /**
   * Post chain: embed page → session media/{id}/info (full video URLs) → link preview → oEmbed thumbnail.
   */
  async getPost(idOrUrl): Promise<Post> {
    const { shortcode } = parseInstagramRef(idOrUrl);
    if (!shortcode) throw new PlatformError("invalid_input", "Paste a valid Instagram post or reel link", 400);
    try {
      const res = await httpGet(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, { retries: 0, proxy: true, failoverOn: [429] });
      if (res.status === 404) throw new PlatformError("not_found", "Post not found or not public", 404);
      const post = parseEmbedHtml(res.text, shortcode);
      if (post) return post;
    } catch (e) {
      if (e instanceof PlatformError && e.code === "not_found") throw e;
    }
    if (hasSession()) {
      const id = shortcodeToId(shortcode);
      for (const [url, client] of [
        [`https://i.instagram.com/api/v1/media/${id}/info/`, "app-session"],
        [`https://www.instagram.com/api/v1/media/${id}/info/`, "web-session"],
      ] as [string, IgClient][]) {
        const r = await igJson(url, client, `https://www.instagram.com/p/${shortcode}/`);
        const it = r.ok ? r.json?.items?.[0] : null;
        if (it) return parseV1Media(it, it.user?.username ?? "");
      }
    }
    for (let i = 0; i < PREVIEW_TRIES; i++) {
      try {
        const preview = parseOgPost(await fetchPreview(`/p/${shortcode}/`, i), shortcode);
        if (preview) return preview;
      } catch (e) {
        if (e instanceof PlatformError && e.code === "not_found") throw e;
      }
    }
    const o = await oembedPost(shortcode);
    if (o) return o;
    throw new PlatformError("blocked", "Instagram did not return this post's media right now (rate-limited). Please try again shortly.", 503);
  },

  async getStories(username): Promise<Story[]> {
    if (!hasSession()) {
      throw new PlatformError("blocked", "Public story viewing requires the server's IG_SESSIONID to be configured.", 503);
    }
    const pk = await resolvePk(username);
    let uname = username;
    if (pk) rememberPk(username, pk);
    else {
      const { profile } = await webProfile(username);
      if (profile.isPrivate) throw new PlatformError("private_account", "Stories of private accounts are not available", 403);
      rememberPk(username, profile.id);
      uname = profile.username;
    }
    const id = pkCache.get(username.toLowerCase());
    if (!id) throw new PlatformError("blocked", "Instagram refused the story request — could not resolve the account id.", 503);
    const tries: [string, IgClient][] = [
      [`https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${id}`, "app-session"],
      [`https://i.instagram.com/api/v1/feed/user/${id}/story/`, "app-session"],
      [`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${id}`, "web-session"],
    ];
    const attempts: IgAttempt[] = [];
    for (const [url, client] of tries) {
      const r = await igJson(url, client, `https://www.instagram.com/stories/${uname}/`);
      attempts.push(r.attempt);
      if (r.ok) {
        const stories = parseReelsMedia(r.json, uname);
        console.info(`[instagram] @${username} stories path=${client}:${url.includes("story") ? "user-story" : "reels_media"} result=ok n=${stories.length}`);
        return stories;
      }
    }
    recordIg(username, attempts, "stories_blocked");
    throw new PlatformError("blocked", "Instagram refused the story request — the server session may need re-login.", 503);
  },
};
