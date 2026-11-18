import "server-only";
/**
 * JSON GET against Instagram's web API with classification of every answer.
 * Signed-in calls go through the session pool: LRU pick, cooldown on 429/"sorry",
 * mark dead on login_required/checkpoint, and fail over within the same request.
 */
import { activeProxyIndex, httpGet, proxyList } from "../../../server/http";
import { igHeaders, type IgClient } from "./cookies";
import type { IgCookies } from "../../../pools/types";
import { currentList } from "../../../pools/ops";
import { snapshot } from "../../../site/snapshot";
import { cookiesFromEntry, pickSession, recordFailure, recordSuccess, sessionLogTag } from "../../../pools/runtime";
import { persistHealthToFirestore } from "../../../pools/persist";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type IgAttempt = { client: IgClient; host: string; status: number; outcome: "ok" | "empty" | "blocked"; note?: string; proxy?: string; session?: string };
export type IgJson = { ok: true; json: any; attempt: IgAttempt } | { ok: false; attempt: IgAttempt };

async function igJsonOnce(url: string, client: IgClient, referer: string | undefined, ig?: IgCookies | null): Promise<IgJson> {
  const host = new URL(url).host;
  const via = () => (proxyList().length ? `proxy#${activeProxyIndex("ig") + 1}` : "direct");
  try {
    const res = await httpGet(url, { headers: igHeaders(client, referer, ig), retries: 1, timeoutMs: 10000, proxy: true, failoverOn: [429] });
    const body = res.text.trimStart();
    if (!body.startsWith("{")) {
      const login = /accounts\/login/.test(res.url) || /"loginPage"|login_and_signup_page/.test(body.slice(0, 5000));
      return { ok: false, attempt: { client, host, status: res.status, outcome: "blocked", note: login ? "login_redirect" : res.status === 429 ? "rate_limited" : "html_response", proxy: via() } };
    }
    const json = JSON.parse(body);
    if (json?.status === "fail" || json?.message === "login_required" || json?.require_login) {
      const msg = String(json?.message ?? "fail");
      return { ok: false, attempt: { client, host, status: res.status, outcome: "blocked", note: msg.slice(0, 80), proxy: via() } };
    }
    return { ok: true, json, attempt: { client, host, status: res.status, outcome: "ok", proxy: via() } };
  } catch (e) {
    return { ok: false, attempt: { client, host, status: 0, outcome: "blocked", note: (e as Error).message?.slice(0, 80), proxy: via() } };
  }
}

/** Signed-in Instagram JSON with session-pool failover. Anonymous calls skip the pool. */
export async function igJson(url: string, client: IgClient, referer?: string): Promise<IgJson> {
  if (client === "web-anon") return igJsonOnce(url, client, referer);

  const list = currentList(snapshot().secrets, "instagram");
  const skip = new Set<string>();
  let last: IgJson | undefined;
  for (let i = 0; i < 5; i++) {
    const entry = pickSession("instagram", list, skip);
    if (!entry) break;
    skip.add(entry.id);
    const ig = cookiesFromEntry(entry);
    if (!ig) continue;
    const r = await igJsonOnce(url, client, referer, ig);
    r.attempt.session = sessionLogTag("instagram", entry);
    last = r;
    if (r.ok) {
      recordSuccess("instagram", entry);
      void persistHealthToFirestore();
      return r;
    }
    const note = r.attempt.note ?? "";
    recordFailure("instagram", entry, note, r.attempt.status);
    void persistHealthToFirestore();
    // Fail over on rate-limit / dead / sorry; stop on empty/not-found-looking notes? keep going for 429/dead/sorry.
    continue;
  }
  if (last) return last;
  return igJsonOnce(url, client, referer);
}
