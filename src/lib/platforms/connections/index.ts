import "server-only";
/**
 * Connections service: privacy gate → every legitimate method in order → cached result.
 *  1. Account private            → locked ("account_private")
 *  2. List hidden by the owner   → locked ("hidden_by_user")
 *  3. TikTok: official Research API → session (TIKTOK_COOKIE + user/list / browser) →
 *     public web → mobile web
 *     Instagram: server session friendships endpoint
 *  4. Nothing returned → counts + deep link + the list of methods tried and why each failed
 * We never generate TikTok request signatures (X-Bogus/msToken) and never touch private accounts.
 */
import { tiktokResearch } from "../../env";
import { cache, cached } from "../../server/cache";
import { PlatformError, type ConnectionAttempt, type ConnectionsResult, type Platform, type Profile } from "../types";
import { researchConnections } from "../tiktok/research/connections";
import { webList } from "../tiktok/followers/web";
import { tikwmList } from "../tiktok/followers/tikwm";
import { igFriendships } from "../instagram/session/friendships";
import { resolvePk } from "../instagram/adapter";
import { igSessionConnections } from "../instagram/session/browser";
import { hasSession } from "../instagram/session/cookies";
import { lockedResult, listUrl, visibilityOf } from "./visibility";
import { followersShow } from "./show";
import { rotateSession } from "../../pools/apply";
import { logError } from "../../server/errorLog";

const TTL = 30 * 60_000;
let lastResearchError: string | null = null;
/** Last TikTok Research API error message (no secrets), for /api/health?ig=1. */
export const researchStatus = () => (tiktokResearch.enabled ? lastResearchError ?? "configured" : "not_configured");


async function tiktokList(profile: Profile, kind: "followers" | "following", cursor?: string) {
  const attempts: ConnectionAttempt[] = [];
  if (tiktokResearch.enabled) {
    try {
      const r = await researchConnections(profile.username, kind, cursor);
      attempts.push({ method: "official_api", ok: r.items.length > 0, note: r.items.length ? "ok" : "empty" });
      if (r.items.length) return { items: r.items, nextCursor: r.nextCursor, provider: "tiktok-research-api", attempts };
    } catch (e) {
      lastResearchError = (e as Error).message?.slice(0, 160) ?? "error";
      if (e instanceof PlatformError && e.code === "private_account") throw e;
      attempts.push({ method: "official_api", ok: false, note: /token|scope|permission|access/i.test(lastResearchError) ? "not_approved" : "error" });
    }
  } else {
    attempts.push({ method: "official_api", ok: false, note: "not_configured" });
  }
  // Public third-party list (fast, no signing) before the slow session/browser paths.
  if (!cursor) {
    const t = await tikwmList(profile.id, kind);
    attempts.push(t.attempt);
    if (t.items.length) return { items: t.items, nextCursor: null, provider: "tikwm", attempts };
  }
  // Browser session only needs the username; HTTP paths need secUid.
  {
    const methods = (["session", "web_public", "mobile_web"] as const);
    for (const method of methods) {
      if (method !== "session" && !profile.secUid) continue;
      let r = await webList(profile.username, profile.secUid || "", kind, method);
      attempts.push(r.attempt);
      // Several TikTok sessions saved in the panel → switch to the next one and retry once.
      if (!r.items.length && method === "session" && r.attempt.note !== "not_configured" && rotateSession("tiktok", `followers ${r.attempt.note ?? "failed"}`)) {
        r = await webList(profile.username, profile.secUid || "", kind, method);
        attempts.push({ ...r.attempt, note: `${r.attempt.note ?? ""} (next_session)` });
      }
      if (r.items.length) return { items: r.items, nextCursor: null, provider: `tiktok-${method}`, attempts };
    }
  }
  logError("tiktok", `@${profile.username} ${kind}: no list — ${attempts.map((a) => `${a.method}=${a.note ?? (a.ok ? "ok" : "fail")}`).join(", ")}`);
  return { items: [], nextCursor: null, provider: undefined, attempts };
}

export async function connectionsFor(profile: Profile, kind: "followers" | "following", cursor?: string): Promise<ConnectionsResult> {
  const vis = visibilityOf(profile, kind);
  if (vis === "private") return lockedResult(profile, kind, "account_private");
  if (vis === "hidden") return lockedResult(profile, kind, "hidden_by_user");
  const total = kind === "followers" ? profile.followers : profile.following;
  const key = `conn:${profile.platform}:${profile.username}:${kind}:${cursor ?? 0}`;

  if (profile.platform === "tiktok") {
    try {
      // Cache hits briefly; empty results expire fast so a fresh session cookie can recover.
      const [r] = await cached(key, 2 * 60_000, () => tiktokList(profile, kind, cursor));
      if (r.items.length) {
        return { available: true, visibility: "public", total, items: r.items.slice(0, followersShow()), nextCursor: r.nextCursor, provider: r.provider, platformUrl: listUrl(profile, kind), attempts: r.attempts };
      }
      // Do not keep empty failures around — delete so the next request retries upstream.
      cache.delete(key);
      return { ...lockedResult(profile, kind, "provider_required"), attempts: r.attempts };
    } catch (e) {
      if (e instanceof PlatformError && e.code === "private_account") return lockedResult(profile, kind, "hidden_by_user");
      return lockedResult(profile, kind, "provider_required");
    }
  }

  const attempts: ConnectionAttempt[] = [];
  const pk = /^\d+$/.test(profile.id) ? profile.id : (hasSession() ? await resolvePk(profile.username).catch(() => null) : null);
  if (hasSession() && pk && /^\d+$/.test(pk)) {
    try {
      const [items] = await cached(key, TTL, () => igFriendships(pk, profile.username, kind));
      attempts.push({ method: "instagram_session", ok: items.length > 0, note: items.length ? "ok" : "empty" });
      if (items.length) {
        return { available: true, visibility: "public", total, items: items.slice(0, followersShow()), provider: "instagram-session", platformUrl: listUrl(profile, kind), attempts };
      }
    } catch {
      attempts.push({ method: "instagram_session", ok: false, note: "blocked" });
    }
  } else {
    attempts.push({ method: "instagram_session", ok: false, note: hasSession() ? "needs_full_profile" : "not_configured" });
  }
  // Logged-in Chromium session (cached 30 min, single browser) when the HTTP friendships path is blocked.
  if (hasSession()) {
    try {
      const [sb] = await cached(`${key}:browser`, TTL, () => igSessionConnections(profile.username, kind));
      attempts.push({ method: "session", ok: !!sb?.items.length, note: sb?.state ?? "empty" });
      if (sb?.items.length) {
        return { available: true, visibility: "public", total, items: sb.items.slice(0, followersShow()), provider: "instagram-session-browser", platformUrl: listUrl(profile, kind), attempts };
      }
    } catch {
      attempts.push({ method: "session", ok: false, note: "browser_error" });
    }
  }
  return { ...lockedResult(profile, kind, "login_only"), attempts };
}

export function providerStatus(platform: Platform) {
  if (platform === "tiktok") return tiktokResearch.enabled ? "tiktok-research-api" : null;
  return hasSession() ? "instagram-session" : null;
}
