import "server-only";
/**
 * TikTok profile sources, tried in order (staggered) by runSources:
 *   tt-page   official profile page SSR JSON (full data + videos with countries)
 *   tt-embed  official embed page (/embed/@user) — counts, bio, avatar, recent videos
 *   countik   countik.com/api/exist — exact counts, secUid, language
 *   tikwm     tikwm.com user/info
 * Every HTTP call uses the proxy → direct → Worker chain (see server/http.ts).
 */
import { extractScriptJson, httpGet, looksLikeBotWall } from "../../server/http";
import { type Post, type Profile } from "../types";
import { parseEmbedState, parseUserDetail } from "./parser";
import { tikwmUser } from "./tikwm";
import { profileFromCountik } from "./countik-parse";
import { NotFoundHere, type Source } from "../../sources/run";

const BASE = "https://www.tiktok.com";

export interface TikTokHit {
  profile: Profile;
  items: Post[];
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v)) || 0;

function base(username: string): Profile {
  return {
    platform: "tiktok",
    id: "",
    username,
    displayName: username,
    bio: "",
    avatarUrl: "",
    verified: false,
    isPrivate: false,
    followers: 0,
    following: 0,
    postsCount: 0,
    profileUrl: `${BASE}/@${username}`,
  };
}

function thin(p: Profile) {
  return !p.id || (!p.secUid && !p.avatarUrl && p.followers === 0 && p.postsCount === 0);
}

export async function pageSource(username: string): Promise<TikTokHit | null> {
  const res = await httpGet(`${BASE}/@${encodeURIComponent(username)}?lang=en`, { timeoutMs: 8000 });
  if (looksLikeBotWall(res.text)) throw new Error(`waf (${res.via ?? "?"})`);
  const json = extractScriptJson(res.text, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!json) throw new Error(`no SSR json (${res.status} via ${res.via ?? "?"})`);
  const { status, profile, items } = parseUserDetail(json);
  if (status === 10221 || status === 10202 || status === 404) throw new NotFoundHere();
  if (!profile || thin(profile)) return null;
  return { profile, items };
}

export async function embedSource(username: string): Promise<TikTokHit | null> {
  const res = await httpGet(`${BASE}/embed/@${encodeURIComponent(username)}`, { timeoutMs: 7000 });
  const json = extractScriptJson(res.text, "__FRONTITY_CONNECT_STATE__");
  if (!json) throw new Error(`no embed json (${res.status} via ${res.via ?? "?"})`);
  const { profile: p, posts } = parseEmbedState(json, username);
  if (!p?.username) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = (json as any)?.source?.data ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ui: any = Object.values(data).map((v) => v?.userInfo).find(Boolean) ?? {};
  const profile: Profile = {
    ...base(p.username),
    ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")),
    likes: n(ui.heartCount) || undefined,
    postsCount: n(ui.videoCount),
    secUid: ui.secUid || undefined,
    profileUrl: `${BASE}/@${p.username}`,
  } as Profile;
  if (!profile.followers && !profile.avatarUrl) return null;
  return { profile, items: posts };
}

export async function countikSource(username: string): Promise<TikTokHit | null> {
  const res = await httpGet(`https://countik.com/api/exist/${encodeURIComponent(username)}`, {
    timeoutMs: 7000,
    headers: { accept: "application/json, text/plain, */*", referer: "https://countik.com/" },
  });
  let j: Record<string, unknown> | null = null;
  try {
    j = JSON.parse(res.text);
  } catch {
    throw new Error(`countik non-json (${res.status} via ${res.via ?? "?"})`);
  }
  if (res.status === 404 || /not found/i.test(String(j?.message ?? ""))) throw new NotFoundHere();
  const profile = profileFromCountik(j as Record<string, unknown>, username);
  return profile ? { profile, items: [] } : null;
}

export async function tikwmSource(username: string): Promise<TikTokHit | null> {
  const r = await tikwmUser(username);
  if (!r.ok) throw new Error(r.note);
  return { profile: r.data, items: [] };
}

export function tiktokSources(username: string): Source<TikTokHit>[] {
  return [
    { id: "tt-page", timeoutMs: 12000, run: () => pageSource(username) },
    { id: "tt-embed", timeoutMs: 10000, run: () => embedSource(username) },
    { id: "countik", timeoutMs: 10000, run: () => countikSource(username) },
    { id: "tikwm", timeoutMs: 10000, run: () => tikwmSource(username) },
  ];
}

/** oembed: cheap "does this account exist" check when every data source failed. */
export async function tiktokExists(username: string): Promise<boolean | undefined> {
  try {
    const res = await httpGet(`${BASE}/oembed?url=${encodeURIComponent(`${BASE}/@${username}`)}`, { timeoutMs: 5000 });
    if (res.status === 200 && res.text.includes("author_name")) return true;
    if (res.status === 400 || res.status === 404) return false;
  } catch {
    /* unknown */
  }
  return undefined;
}
