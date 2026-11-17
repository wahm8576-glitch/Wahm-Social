import "server-only";
/**
 * Public tikwm.com list endpoints (`/api/user/following`, `/api/user/followers`) — no signing, only the
 * numeric TikTok user id. tikwm currently serves "following" but answers "This endpoint is unavailable"
 * for "followers"; we still try both so the list comes back automatically if tikwm re-enables it.
 * Tries the server's own IP first, then the proxy pool.
 */
import { httpGet } from "../../../server/http";
import { logError } from "../../../server/errorLog";
import type { Connection, ConnectionAttempt } from "../../types";

const BASE = "https://www.tikwm.com/api/user";
const UNAVAILABLE_TTL = 30 * 60_000;
const unavailableUntil: Record<string, number> = {};

function parse(j: any, kind: "followers" | "following"): Connection[] {
  const d = j?.data ?? {};
  const list: any[] = (kind === "following" ? d.followings ?? d.following : d.followers) ?? d.users ?? d.user_list ?? [];
  return list
    .filter((u) => u?.unique_id || u?.uniqueId)
    .map((u) => {
      const username = String(u.unique_id || u.uniqueId);
      return { username, displayName: String(u.nickname || username), avatarUrl: String(u.avatar || u.avatarThumb || ""), verified: Boolean(u.verified) };
    });
}

export async function tikwmList(userId: string, kind: "followers" | "following"): Promise<{ items: Connection[]; attempt: ConnectionAttempt; nextCursor: string | null }> {
  const fail = (note: string) => ({ items: [], attempt: { method: "third_party" as const, ok: false, note }, nextCursor: null });
  if (!/^\d{5,}$/.test(userId)) return fail("needs_user_id");
  if ((unavailableUntil[kind] ?? 0) > Date.now()) return fail("tikwm_unavailable");
  const url = `${BASE}/${kind}?user_id=${userId}&count=50&cursor=0`;
  let last = "tikwm_error";
  // Free tier allows ~1 request/second per IP: on that message wait and retry once on the same route.
  const routes = [false, false, true, true];
  for (let i = 0; i < routes.length; i++) {
    const proxy = routes[i];
    // The repeat slot on a route is only for a rate-limit retry.
    if (i % 2 === 1 && last !== "tikwm_quota") continue;
    last = "tikwm_error";
    try {
      const res = await httpGet(url, { proxy, retries: 0, timeoutMs: 9000, headers: { accept: "application/json", referer: "https://www.tikwm.com/" } });
      const t = res.text.trim();
      if (!t.startsWith("{")) {
        last = res.status === 403 || res.status === 429 || /just a moment|cloudflare/i.test(t) ? "tikwm_blocked" : `http_${res.status}`;
        continue;
      }
      const j = JSON.parse(t);
      if (j?.code !== 0) {
        const msg = String(j?.msg ?? "");
        if (/unavailable/i.test(msg)) {
          unavailableUntil[kind] = Date.now() + UNAVAILABLE_TTL;
          return fail("tikwm_unavailable");
        }
        if (/hiding|private/i.test(msg)) return fail("hidden_by_user");
        if (/limit|quota|free api/i.test(msg)) {
          last = "tikwm_quota";
          logError("tikwm", `${kind} list (${proxy ? "proxy" : "direct"}): ${msg.slice(0, 80)}`);
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        return fail(msg.slice(0, 40) || "tikwm_error");
      }
      const items = parse(j, kind);
      const d = j.data ?? {};
      return { items, attempt: { method: "third_party", ok: items.length > 0, note: items.length ? "ok" : "tikwm_empty" }, nextCursor: d.hasMore ? String(d.cursor ?? d.time ?? "") || null : null };
    } catch (e) {
      last = (e as Error).message?.slice(0, 40) || "tikwm_error";
    }
  }
  return fail(last);
}
