import "server-only";
/**
 * Instagram via a logged-in Chromium session (the HTTP API refuses our datacenter IP even with
 * valid cookies, but a real browser with the same cookies works). We navigate to the profile and
 * capture Instagram's own graphql / feed responses — so IG does the signing.
 *
 * To protect the account the result is cached per username for 30 minutes and only one browser
 * runs at a time (shared lock with the TikTok follower browser). Checkpoints/logouts are detected.
 */
import type { Connection, Post, Profile } from "../../types";
import { parseV1Media, parseV1User } from "./v1";
import { igSessionCookies, hasIgSession } from "./cookies";
import { proxyForBrowser } from "../../../server/http";
import { browserLock } from "../../tiktok/followers/lock";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL = 30 * 60_000;

export type IgSessionState = "ok" | "checkpoint" | "logged_out" | "not_configured" | "error" | "empty";
export interface IgSessionResult {
  profile?: Profile;
  posts: Post[];
  connections?: { followers?: Connection[]; following?: Connection[] };
  state: IgSessionState;
  at: number;
}

const g = globalThis as unknown as { __igSess?: Map<string, IgSessionResult>; __igSessErr?: { at: number; state: IgSessionState } | null };
const store = (g.__igSess ??= new Map());
export const igSessionStatus = () => g.__igSessErr ?? null;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function deepFind(o: Any, pred: (v: Any) => boolean): Any {
  if (!o || typeof o !== "object") return undefined;
  if (pred(o)) return o;
  for (const v of Array.isArray(o) ? o : Object.values(o)) {
    const r = deepFind(v, pred);
    if (r !== undefined) return r;
  }
  return undefined;
}
function deepCollect(o: Any, pred: (v: Any) => boolean, out: Any[] = []): Any[] {
  if (!o || typeof o !== "object") return out;
  if (pred(o)) out.push(o);
  for (const v of Array.isArray(o) ? o : Object.values(o)) deepCollect(v, pred, out);
  return out;
}

async function launch(proxyServer?: string) {
  const proxyArgs = proxyServer ? [`--proxy-server=${proxyServer}`] : [];
  const stealthMod = await import("puppeteer-extra-plugin-stealth");
  const puppeteerExtra = await import("puppeteer-extra");
  const puppeteer = puppeteerExtra.default;
  puppeteer.use(stealthMod.default());
  const fs = await import("fs");
  for (const bin of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", process.env.CHROME_PATH].filter(Boolean) as string[]) {
    if (fs.existsSync(bin)) {
      return puppeteer.launch({
        executablePath: bin,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled", "--lang=en-US", ...proxyArgs],
      });
    }
  }
  const chromium = await import("@sparticuz/chromium");
  return puppeteer.launch({
    args: [...chromium.default.args, "--lang=en-US", "--no-sandbox", ...proxyArgs],
    defaultViewport: { width: 1280, height: 900 },
    executablePath: await chromium.default.executablePath(),
    headless: true,
  });
}

async function run(username: string): Promise<IgSessionResult> {
  const proxy = proxyForBrowser();
  const browser = await launch(proxy?.server);
  const userObjs: Any[] = [];
  const mediaItems: Any[] = [];
  try {
    const page = await browser.newPage();
    if (proxy?.username) await page.authenticate({ username: proxy.username, password: proxy.password ?? "" });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await page.setCookie(...igSessionCookies());
    await page.setRequestInterception(true);
    page.on("request", (req: Any) => {
      if (req.isInterceptResolutionHandled?.()) return;
      const t = req.resourceType();
      t === "image" || t === "media" || t === "font" ? req.abort().catch(() => {}) : req.continue().catch(() => {});
    });
    page.on("response", async (res: Any) => {
      try {
        const u: string = res.url();
        if (!/graphql|web_profile_info|api\/v1\/feed\/user/.test(u)) return;
        const txt = await res.text();
        if (!txt.trimStart().startsWith("{") || txt.length < 300) return;
        const json = JSON.parse(txt);
        for (const user of deepCollect(json, (v) => v && typeof v === "object" && typeof v.username === "string" && ("follower_count" in v || "edge_followed_by" in v))) userObjs.push(user);
        for (const it of deepCollect(json, (v) => v && typeof v === "object" && (v.media_type !== undefined) && (v.code || v.pk) && v.image_versions2)) mediaItems.push(it);
      } catch {
        /* ignore */
      }
    });
    console.warn(`[ig-session] @${username} navigating (proxy=${proxy ? "yes" : "no"})`);
    const resp = await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, { waitUntil: "networkidle2", timeout: 40000 }).catch(() => null);
    const finalUrl = page.url();
    if (/accounts\/login|\/challenge\//.test(finalUrl)) {
      return { posts: [], state: /challenge/.test(finalUrl) ? "checkpoint" : "logged_out", at: Date.now() };
    }
    // Give lazy post/profile queries a moment, then a small scroll to trigger the posts grid.
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => window.scrollBy(0, 1400)).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    if (resp && resp.status() === 404 && !userObjs.length) return { posts: [], state: "empty", at: Date.now() };

    const best = userObjs.find((u) => String(u.username).toLowerCase() === username.toLowerCase()) ?? userObjs[0];
    const profile = best ? parseV1User({ ...best, following_count: best.following_count ?? best.edge_follow?.count, follower_count: best.follower_count ?? best.edge_followed_by?.count, media_count: best.media_count ?? best.edge_owner_to_timeline_media?.count }) : undefined;
    const seen = new Set<string>();
    const posts = mediaItems
      .map((it) => parseV1Media(it, username))
      .filter((p) => (p.media.length || p.cover) && !seen.has(p.id) && (seen.add(p.id), true));
    console.warn(`[ig-session] @${username} done: profile=${profile ? "yes" : "no"} followers=${profile?.followers ?? "-"} posts=${posts.length} userObjs=${userObjs.length} media=${mediaItems.length}`);
    return { profile: profile ?? undefined, posts, state: profile ? "ok" : "empty", at: Date.now() };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Cached, rate-limited, single-browser IG session lookup. Returns null when no session or busy/cooldown. */
export async function igSessionLookup(username: string, opts: { force?: boolean } = {}): Promise<IgSessionResult | null> {
  if (!hasIgSession()) return null;
  const key = username.toLowerCase();
  const hit = store.get(key);
  if (hit && !opts.force && Date.now() - hit.at < TTL) return hit;
  const r = await browserLock(async () => run(username)).catch((e) => {
    console.warn(`[ig-session] @${username} error: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return { posts: [] as Post[], profile: undefined, state: "error" as IgSessionState, at: Date.now() } as IgSessionResult;
  });
  if (r === "busy") {
    console.warn(`[ig-session] @${username} browser busy/cooldown`);
    return hit ?? null;
  }
  if (r.state === "checkpoint" || r.state === "logged_out" || r.state === "error") {
    g.__igSessErr = { at: Date.now(), state: r.state };
  } else {
    g.__igSessErr = null;
  }
  if (r.state === "ok" || r.state === "empty") store.set(key, r);
  if (store.size > 500) store.delete(store.keys().next().value as string);
  // Upgrade the shared caches with the exact session data (the fast sources may have cached rounded data first).
  if (r.state === "ok" && r.profile) {
    const { cache, TTL } = await import("../../../server/cache");
    const { saveLastGood } = await import("../../../server/lastGood");
    const pk = `profile:instagram:${username}:v3`;
    cache.set(pk, r.profile, TTL.profile);
    cache.set(`stale:${pk}`, r.profile, TTL.stale);
    saveLastGood(pk, r.profile);
    if (r.posts.length) {
      for (const n of [12, 24, 50]) cache.set(`posts:instagram:${username}:${n}`, r.posts.slice(0, n), TTL.posts);
    }
  }
  return r;
}

function parseConnUser(u: Any): Connection | null {
  if (!u?.username) return null;
  return {
    username: String(u.username),
    displayName: String(u.full_name || u.username),
    avatarUrl: String(u.profile_pic_url || ""),
    verified: !!u.is_verified,
  };
}

/** IG followers/following via the logged-in browser: fetch the friendships API inside the IG page (it is authorized there). */
async function runConnections(username: string, kind: "followers" | "following"): Promise<{ items: Connection[]; state: IgSessionState }> {
  const proxy = proxyForBrowser();
  const browser = await launch(proxy?.server);
  try {
    const page = await browser.newPage();
    if (proxy?.username) await page.authenticate({ username: proxy.username, password: proxy.password ?? "" });
    await page.setUserAgent(UA);
    await page.setCookie(...igSessionCookies());
    const resp = await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => null);
    if (/accounts\/login|\/challenge\//.test(page.url())) return { items: [], state: /challenge/.test(page.url()) ? "checkpoint" : "logged_out" };
    if (resp && resp.status() === 404) return { items: [], state: "empty" };
    await new Promise((r) => setTimeout(r, 1500));
    const out = await page.evaluate(
      async (kind: string) => {
        const m = location.pathname.match(/^\/([^/]+)/);
        const uname = m ? m[1] : "";
        // Resolve the numeric id via web_profile_info in-page (authorized in this context).
        const info = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, { headers: { "x-ig-app-id": "936619743392459" }, credentials: "include" }).then((r) => r.json()).catch(() => null);
        const pk = info?.data?.user?.id;
        if (!pk) return { pk: null, users: [] as unknown[] };
        const users: unknown[] = [];
        let max = "";
        for (let i = 0; i < 3 && users.length < 60; i++) {
          const url = `/api/v1/friendships/${pk}/${kind}/?count=30${max ? `&max_id=${max}` : ""}`;
          const j = await fetch(url, { headers: { "x-ig-app-id": "936619743392459" }, credentials: "include" }).then((r) => r.json()).catch(() => null);
          if (!j?.users?.length) break;
          users.push(...j.users);
          if (!j.next_max_id) break;
          max = j.next_max_id;
          await new Promise((r) => setTimeout(r, 600));
        }
        return { pk, users };
      },
      kind,
    );
    const items = (out.users as Any[]).map(parseConnUser).filter(Boolean) as Connection[];
    return { items, state: items.length ? "ok" : "empty" };
  } finally {
    await browser.close().catch(() => {});
  }
}

const connStore = (globalThis as unknown as { __igConn?: Map<string, { items: Connection[]; at: number; state: IgSessionState }> }).__igConn ??= new Map();

/** Cached (30 min), single-browser IG followers/following. null when no session or busy. */
export async function igSessionConnections(username: string, kind: "followers" | "following"): Promise<{ items: Connection[]; state: IgSessionState } | null> {
  if (!hasIgSession()) return null;
  const key = `${username.toLowerCase()}:${kind}`;
  const hit = connStore.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const r = await browserLock(() => runConnections(username, kind));
  if (r === "busy") return hit ?? null;
  if (r.state === "checkpoint" || r.state === "logged_out") g.__igSessErr = { at: Date.now(), state: r.state };
  if (r.items.length) connStore.set(key, { ...r, at: Date.now() });
  return r;
}


/** Snapshot of the current session result for a profile (store only, no browser launch). */
export function igSessionPeek(username: string): IgSessionResult | "running" | null {
  const key = username.toLowerCase();
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit;
  return inflight.has(key) ? "running" : null;
}

const inflight = new Map<string, Promise<unknown>>();

/** Start a background session run if one isn't cached or already running. Never throws. */
export function igSessionStart(username: string): void {
  if (!hasIgSession()) return;
  const key = username.toLowerCase();
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL) return;
  if (inflight.has(key)) return;
  const pr = igSessionLookup(username, { force: true }).catch(() => undefined).finally(() => inflight.delete(key));
  inflight.set(key, pr);
}
