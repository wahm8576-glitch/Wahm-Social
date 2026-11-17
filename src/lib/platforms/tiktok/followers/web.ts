import "server-only";
/**
 * TikTok follower / following list with a logged-in session.
 *
 * Working order (session method):
 *  1. Warm the profile with TIKTOK_COOKIE to rotate msToken.
 *  2. GET www.tiktok.com/api/user/list/?… (scenes 67/21 then 151) — no X-Bogus.
 *  3. Same on m.tiktok.com if www returns empty.
 *  4. Headless Chromium: TikTok's own JS signs the request; we intercept JSON.
 *
 * Never calls /api/commit/follow/list (returns status_msg "url doesn't match").
 */
import { cookiesFrom, DESKTOP_UA, httpGet, MOBILE_UA } from "../../../server/http";
import { cookieRaw, cookieValue, hasTikTokSession, tiktokCookieHeader, tiktokWebHeaders, CHROME_UA } from "../session";
import { browserList, lastBrowserListTry } from "./browser";
import type { Connection, ConnectionAttempt } from "../../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SCENE = { followers: ["67", "151"], following: ["21", "151"] } as const;
const HOSTS = ["www.tiktok.com", "m.tiktok.com"] as const;

async function anonCookies(username: string, ua: string): Promise<string> {
  try {
    const res = await httpGet(`https://www.tiktok.com/@${encodeURIComponent(username)}`, { headers: { "user-agent": ua }, retries: 0, timeoutMs: 8000 });
    return cookiesFrom(res.headers);
  } catch {
    return "";
  }
}

const regionHints = new Map<string, string>();
export function rememberedRegion(username: string): string | undefined {
  return regionHints.get(username.toLowerCase());
}
export const regionHintCount = () => regionHints.size;
export const regionHintSample = () => [...regionHints.entries()].slice(0, 5).map(([u, r]) => ({ u, r }));
let lastUserKeys: string[] = [];
export const lastListUserKeys = () => lastUserKeys;

function rememberRegion(username: string, region?: string) {
  if (!region || !/^[A-Z]{2}$/.test(region)) return;
  regionHints.set(username.toLowerCase(), region);
  if (regionHints.size > 5000) regionHints.delete(regionHints.keys().next().value as string);
}

function parseUsers(j: any): Connection[] {
  const list: any[] = j?.userList ?? [];
  const users = list.map((x: any) => x?.user ?? x).filter((u: any) => u?.uniqueId || u?.unique_id);
  if (users[0]) lastUserKeys = Object.keys(users[0]).sort();
  return users.map((u: any) => {
    const username = u.uniqueId || u.unique_id;
    const region = typeof u.region === "string" && /^[A-Za-z]{2}$/.test(u.region) ? u.region.toUpperCase() : undefined;
    if (region) rememberRegion(String(username), region);
    return {
      username,
      displayName: u.nickname || username,
      avatarUrl: u.avatarThumb || u.avatarMedium || "",
      verified: !!u.verified,
    };
  });
}

/** Merge Set-Cookie into an existing Cookie header (last-wins per name). */
function mergeCookie(base: string, setCookieHeader: string): string {
  if (!setCookieHeader) return base;
  const map = new Map<string, string>();
  for (const part of base.split(";")) {
    const s = part.trim();
    if (!s.includes("=")) continue;
    const i = s.indexOf("=");
    map.set(s.slice(0, i).trim(), s.slice(i + 1).trim());
  }
  for (const part of setCookieHeader.split(";")) {
    const s = part.trim();
    if (!s.includes("=")) continue;
    const i = s.indexOf("=");
    const name = s.slice(0, i).trim();
    const val = s.slice(i + 1).trim();
    if (name && val && !/^(domain|path|expires|max-age|secure|httponly|samesite)$/i.test(name)) map.set(name, val);
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Load the profile with the session cookie; capture rotated msToken from Set-Cookie. */
async function refreshSession(username: string): Promise<{ msToken: string; cookie: string; verifyFp: string; deviceId: string; region: string }> {
  let cookie = tiktokCookieHeader();
  let ms = cookieValue("msToken"); // decode-once if percent-encoded
  const verifyFp = cookieRaw("s_v_web_id");
  let deviceId = cookieRaw("ttwid") || verifyFp;
  let region = (cookieValue("store-country-code") || "US").toUpperCase();
  try {
    const res = await httpGet(`https://www.tiktok.com/@${encodeURIComponent(username)}?lang=en`, {
      headers: { "user-agent": CHROME_UA, cookie, accept: "text/html", referer: "https://www.tiktok.com/" },
      retries: 0,
      timeoutMs: 12000,
      proxy: Boolean(process.env.SCRAPER_PROXY),
    });
    const realProfile = res.text.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__") || res.text.includes("webapp.user-detail");
    const waf = !realProfile && (res.text.length < 5000 || /slardar|captcha|challenge/i.test(res.text.slice(0, 2000)));
    // Only merge Set-Cookie when we got a real profile — WAF pages rotate msToken into a useless challenge token.
    if (!waf) {
      const set = cookiesFrom(res.headers);
      if (set) {
        cookie = mergeCookie(cookie, set);
        const m = set.match(/(?:^|;\s*)msToken=([^;]+)/);
        if (m) {
          const raw = m[1];
          ms = /%[0-9A-Fa-f]{2}/.test(raw) ? (() => { try { return decodeURIComponent(raw); } catch { return raw; } })() : raw;
        }
        const did = set.match(/(?:^|;\s*)ttwid=([^;]+)/);
        if (did) deviceId = did[1];
      }
    } else {
      console.warn(`[tiktok-followers] warm skipped (waf/short html len=${res.text.length})`);
    }
    const um = res.text.match(/id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (um) {
      try {
        const u = JSON.parse(um[1])?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.user;
        if (typeof u?.region === "string" && /^[A-Za-z]{2}$/.test(u.region)) {
          rememberRegion(username, u.region.toUpperCase());
          region = u.region.toUpperCase();
        }
      } catch { /* ignore */ }
    }
  } catch { /* keep existing */ }
  return { msToken: ms, cookie, verifyFp, deviceId, region };
}

function buildListUrl(
  host: string,
  secUid: string,
  scene: string,
  opts: { msToken: string; deviceId: string; verifyFp: string; region: string; mobile: boolean },
): string {
  const qs = new URLSearchParams({
    aid: "1988",
    app_language: "en",
    app_name: "tiktok_web",
    browser_language: "en-US",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: opts.mobile ? "iPhone" : "Win32",
    channel: "tiktok_web",
    cookie_enabled: "true",
    count: "30",
    device_platform: opts.mobile ? "web_mobile" : "web_pc",
    focus_state: "true",
    from_page: "user",
    history_len: "3",
    is_fullscreen: "false",
    is_page_visible: "true",
    maxCursor: "0",
    minCursor: "0",
    os: opts.mobile ? "ios" : "windows",
    region: opts.region,
    scene,
    screen_height: opts.mobile ? "844" : "1080",
    screen_width: opts.mobile ? "390" : "1920",
    secUid,
    webcast_language: "en",
  });
  if (opts.msToken) qs.set("msToken", opts.msToken);
  if (opts.deviceId) qs.set("device_id", opts.deviceId);
  if (opts.verifyFp) qs.set("verifyFp", opts.verifyFp);
  return `https://${host}/api/user/list/?${qs}`;
}

async function callList(
  url: string,
  headers: Record<string, string>,
  method: ConnectionAttempt["method"],
): Promise<{ items: Connection[]; attempt: ConnectionAttempt; status: number; bodyLen: number }> {
  try {
    const res = await httpGet(url, { headers, retries: 0, timeoutMs: 10000, proxy: Boolean(process.env.SCRAPER_PROXY) });
    const body = res.text.trim();
    if (!body) return { items: [], attempt: { method, ok: false, note: "empty_unsigned" }, status: res.status, bodyLen: 0 };
    if (!body.startsWith("{")) return { items: [], attempt: { method, ok: false, note: `http_${res.status}` }, status: res.status, bodyLen: body.length };
    const j = JSON.parse(body);
    const items = parseUsers(j);
    const statusMsg = String(j?.status_msg || j?.statusMsg || "").slice(0, 60);
    const note = items.length ? "ok" : statusMsg || (j?.statusCode !== undefined ? `status_${j.statusCode}` : "empty_json");
    return { items, attempt: { method, ok: items.length > 0, note }, status: res.status, bodyLen: body.length };
  } catch (e) {
    return { items: [], attempt: { method, ok: false, note: (e as Error).message?.slice(0, 40) ?? "error" }, status: 0, bodyLen: 0 };
  }
}

let lastSessionTry: { at: string; status: number; bodyLen: number; note: string; urlHost: string; via?: string; scene?: string } | null = null;
export const lastFollowerTry = () =>
  lastSessionTry ??
  (lastBrowserListTry()
    ? {
        at: lastBrowserListTry()!.at,
        status: lastBrowserListTry()!.status ?? 0,
        bodyLen: lastBrowserListTry()!.bodyLen ?? 0,
        note: lastBrowserListTry()!.note,
        urlHost: "browser",
        via: "browser",
      }
    : null);

export async function webList(
  username: string,
  secUid: string,
  kind: "followers" | "following",
  method: ConnectionAttempt["method"],
): Promise<{ items: Connection[]; attempt: ConnectionAttempt }> {
  const referer = `https://www.tiktok.com/@${username}`;

  if (method === "session") {
    if (!hasTikTokSession()) return { items: [], attempt: { method, ok: false, note: "not_configured" } };

    // A) HTTP user/list with refreshed session — www then m, scenes 67/21 then 151.
    if (secUid) {
      const warm = await refreshSession(username);
      const headers = tiktokWebHeaders(referer, warm.cookie);
      for (const host of HOSTS) {
        const mobile = host.startsWith("m.");
        for (const scene of SCENE[kind]) {
          const url = buildListUrl(host, secUid, scene, {
            msToken: warm.msToken,
            deviceId: warm.deviceId,
            verifyFp: warm.verifyFp,
            region: warm.region,
            mobile,
          });
          const r = await callList(url, headers, method);
          lastSessionTry = {
            at: new Date().toISOString(),
            status: r.status,
            bodyLen: r.bodyLen,
            note: r.attempt.note,
            urlHost: host,
            via: "http",
            scene,
          };
          console.warn(`[tiktok-followers] http ${host} scene=${scene} status=${r.status} body=${r.bodyLen} note=${r.attempt.note}`);
          if (r.items.length) return { items: r.items, attempt: r.attempt };
        }
      }
    }

    // B) Chromium — TikTok page JS adds the signature we refuse to reverse-engineer.
    try {
      const br = await Promise.race([
        browserList(username, kind, secUid),
        new Promise<Awaited<ReturnType<typeof browserList>>>((_, rej) =>
          setTimeout(() => rej(new Error("browser_timeout")), 45000),
        ),
      ]);
      lastSessionTry = {
        at: new Date().toISOString(),
        status: br.status ?? 0,
        bodyLen: br.bodyLen ?? 0,
        note: br.note,
        urlHost: "browser",
        via: "browser",
      };
      if (br.region) rememberRegion(username, br.region);
      if (br.items.length) return { items: br.items, attempt: { method, ok: true, note: "ok" } };
    } catch (e) {
      lastSessionTry = {
        at: new Date().toISOString(),
        status: 0,
        bodyLen: 0,
        note: (e as Error).message?.slice(0, 40) ?? "browser_error",
        urlHost: "browser",
        via: "browser",
      };
    }

    return { items: [], attempt: { method, ok: false, note: lastSessionTry?.note ?? "empty_unsigned" } };
  }

  const mobile = method === "mobile_web";
  const ua = mobile ? MOBILE_UA : DESKTOP_UA;
  if (!secUid) return { items: [], attempt: { method, ok: false, note: "empty_unsigned" } };
  const cookie = await anonCookies(username, ua);
  const qs = new URLSearchParams({
    aid: "1988",
    app_language: "en",
    app_name: "tiktok_web",
    device_platform: mobile ? "web_mobile" : "web_pc",
    count: "30",
    maxCursor: "0",
    minCursor: "0",
    scene: SCENE[kind][0],
    secUid,
  });
  const r = await callList(`https://www.tiktok.com/api/user/list/?${qs}`, {
    "user-agent": ua,
    referer,
    accept: "application/json",
    ...(cookie ? { cookie } : {}),
  }, method);
  return { items: r.items, attempt: r.attempt };
}

export const sessionConfigured = () => ({
  cookie: hasTikTokSession(),
  hasMsToken: Boolean(cookieRaw("msToken")),
  hasCsrf: Boolean(cookieRaw("tt_csrf_token")),
});
