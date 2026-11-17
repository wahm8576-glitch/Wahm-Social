import type { Profile } from "../types";
/**
 * Pure mappers for countik.com JSON. Language + video-id hints only.
 * Never invents a country from an empty video list.
 */
import { isRecord } from "./fallback-http";

export function languageFromCountik(info: unknown): string | undefined {
  if (!isRecord(info)) return undefined;
  const lang = info.language;
  return typeof lang === "string" && lang.trim() ? lang.trim() : undefined;
}

export function videoIdsFromAnalyze(analyze: unknown): string[] {
  if (!isRecord(analyze) || !Array.isArray(analyze.videos)) return [];
  const ids: string[] = [];
  for (const v of analyze.videos) {
    if (!isRecord(v)) continue;
    const id = v.id ?? v.aweme_id ?? v.video_id;
    if (typeof id === "string" && /^\d{15,22}$/.test(id)) ids.push(id);
    else if (typeof id === "number" && Number.isFinite(id)) {
      const s = String(id);
      if (/^\d{15,22}$/.test(s)) ids.push(s);
    }
  }
  return ids;
}

const cnum = (v: unknown) => (typeof v === "number" ? v : Number(v)) || 0;

/** countik.com/api/exist/<user> → full profile (exact counts). */
export function profileFromCountik(j: Record<string, unknown>, username: string): Profile | null {
  if (!j || j.status !== "success" || !j.id) return null;
  const u = String(j.uniqueId || username);
  return {
    platform: "tiktok",
    username: u,
    isPrivate: false,
    profileUrl: `https://www.tiktok.com/@${u}`,
    id: String(j.id),
    displayName: String(j.nickname || u),
    bio: String(j.signature || ""),
    avatarUrl: String(j.avatarThumb || ""),
    verified: !!j.verified,
    followers: cnum(j.followerCount),
    following: cnum(j.followingCount),
    likes: cnum(j.heartCount),
    postsCount: cnum(j.videoCount),
    secUid: j.sec_uid ? String(j.sec_uid) : undefined,
    language: j.language ? String(j.language) : undefined,
  };
}

