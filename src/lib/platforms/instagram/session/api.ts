import "server-only";
/**
 * JSON GET against Instagram's web API with classification of every answer.
 * Instagram replies to blocked calls with HTML 404s, 302s to /accounts/login,
 * or JSON {"status":"fail","message":"..."} — none of those mean "not found".
 */
import { activeProxyIndex, httpGet, proxyList } from "../../../server/http";
import { igHeaders, type IgClient } from "./cookies";
import { rotateSession } from "../../../pools/apply";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type IgAttempt = { client: IgClient; host: string; status: number; outcome: "ok" | "empty" | "blocked"; note?: string; proxy?: string };
export type IgJson = { ok: true; json: any; attempt: IgAttempt } | { ok: false; attempt: IgAttempt };

export async function igJson(url: string, client: IgClient, referer?: string): Promise<IgJson> {
  const host = new URL(url).host;
  const via = () => (proxyList().length ? `proxy#${activeProxyIndex("ig") + 1}` : "direct");
  try {
    // Every Instagram call goes through SCRAPER_PROXY; a 429 moves on to the next proxy in the list.
    const res = await httpGet(url, { headers: igHeaders(client, referer), retries: 1, timeoutMs: 10000, proxy: true, failoverOn: [429] });
    const body = res.text.trimStart();
    if (!body.startsWith("{")) {
      const login = /accounts\/login/.test(res.url) || /"loginPage"|login_and_signup_page/.test(body.slice(0, 5000));
      if (login && client !== "web-anon") rotateSession("instagram", "login_redirect");
      return { ok: false, attempt: { client, host, status: res.status, outcome: "blocked", note: login ? "login_redirect" : res.status === 429 ? "rate_limited" : "html_response", proxy: via() } };
    }
    const json = JSON.parse(body);
    if (json?.status === "fail" || json?.message === "login_required" || json?.require_login) {
      const msg = String(json?.message ?? "fail");
      if (client !== "web-anon" && /login_required|checkpoint|challenge/i.test(msg)) rotateSession("instagram", msg.slice(0, 40));
      return { ok: false, attempt: { client, host, status: res.status, outcome: "blocked", note: msg.slice(0, 80), proxy: via() } };
    }
    return { ok: true, json, attempt: { client, host, status: res.status, outcome: "ok", proxy: via() } };
  } catch (e) {
    return { ok: false, attempt: { client, host, status: 0, outcome: "blocked", note: (e as Error).message?.slice(0, 80), proxy: via() } };
  }
}
