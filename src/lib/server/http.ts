/**
 * Small fetch wrapper used by every scraper: timeouts, retries with backoff,
 * realistic browser headers and structured errors.
 */
import { PlatformError } from "../platforms/types";
import { activeRelayIndex, failoverRelay, recordRelayTry, relayList, rewriteViaRelay, shouldRelay } from "./relay";
import { logError } from "./errorLog";

export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: string;
  /** Route through SCRAPER_PROXY when it is configured (Instagram blocks shared datacenter IPs). */
  proxy?: boolean;
  /** With `proxy`: these HTTP statuses switch to the next proxy and retry (e.g. [429]). */
  failoverOn?: number[];
}

export interface FetchResult {
  status: number;
  text: string;
  headers: Headers;
  url: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** instagram.com and its CDNs (cdninstagram / fbcdn): never contacted directly when a proxy exists. */
export function isInstagramHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "instagram.com" || h.endsWith(".instagram.com") || h.endsWith(".cdninstagram.com") || h.endsWith(".fbcdn.net");
  } catch {
    return false;
  }
}

/**
 * Every Instagram request goes through the proxy list (SCRAPER_PROXY / admin "البروكسيات"), in order,
 * moving to the next proxy on connection errors, 407 and 429. If every proxy is refused and the request
 * is a public GET without cookies, the Cloudflare Worker list (RELAY_URL) is tried as the last fallback.
 * A direct request from the server IP happens only when no proxy and no Worker is configured at all.
 */
async function instagramGet(url: string, opts: FetchOptions): Promise<FetchResult> {
  const failoverOn = [...new Set([...(opts.failoverOn ?? []), 429])];
  const hasProxy = proxyList().length > 0;
  const relayable = relayList().length > 0 && canRelayRequest(opts);
  if (!hasProxy && !relayable) return baseGet(url, { ...opts, proxy: false });
  let viaProxy: FetchResult | undefined;
  let proxyErr: unknown;
  if (hasProxy) {
    try {
      viaProxy = await baseGet(url, { ...opts, proxy: true, failoverOn });
      if (!igRefused(viaProxy)) return viaProxy;
    } catch (e) {
      proxyErr = e;
    }
  }
  if (relayable) {
    const viaRelay = await relayGet(url, opts).catch(() => undefined);
    if (viaRelay && (!igRefused(viaRelay) || !viaProxy)) return viaRelay;
  }
  if (viaProxy) return viaProxy;
  throw proxyErr ?? new PlatformError("upstream_error", "Instagram request failed via every proxy and Worker", 502);
}

/** Instagram said no: rate limit, or bounced to the login / challenge page. */
function igRefused(r: FetchResult): boolean {
  return r.status === 429 || r.status === 401 || /\/accounts\/login|\/challenge\//.test(r.url);
}

function canRelayRequest(opts: FetchOptions): boolean {
  if ((opts.method ?? "GET").toUpperCase() !== "GET" || opts.body) return false;
  return !Object.entries(opts.headers ?? {}).some(([k, v]) => k.toLowerCase() === "cookie" && !!v);
}

/** One try per Worker, in order. A Worker that does not allow the host answers 403 "blocked host". */
async function relayGet(url: string, opts: FetchOptions): Promise<FetchResult | undefined> {
  const list = relayList();
  for (let i = 0; i < list.length; i++) {
    const base = list[(activeRelayIndex() + i) % list.length];
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12000);
    try {
      const res = await fetch(rewriteViaRelay(url, base), {
        headers: { "user-agent": DESKTOP_UA, "accept-language": "en-US,en;q=0.9,ar;q=0.8", ...opts.headers },
        signal: ctrl.signal,
        cache: "no-store",
      } as RequestInit);
      const text = await res.text();
      recordRelayTry(url, res.status, res.status < 400);
      if (res.status === 403 && /blocked host/i.test(text.slice(0, 60))) {
        logError("relay", `Worker does not allow ${hostOf(url)} (add it to the Worker allowlist)`);
        continue;
      }
      if (res.status >= 500) continue;
      return { status: res.status, text, headers: res.headers, url };
    } catch (e) {
      recordRelayTry(url, undefined, false);
      logError("relay", `Worker request failed for ${hostOf(url)}: ${String((e as Error)?.message ?? e)}`);
    } finally {
      clearTimeout(t);
    }
  }
  return undefined;
}

export async function httpGet(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  if (isInstagramHost(url)) return instagramGet(url, opts);
  return baseGet(url, opts);
}

async function baseGet(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const { timeoutMs = 12000 } = opts;
  // One extra attempt per spare proxy / spare Worker so a dead one fails over within the same call.
  const spare = opts.proxy ? Math.max(0, proxyList().length - 1) : 0;
  const relaySpare = shouldRelay(url, opts) ? relayList().length : 0;
  const retries = (opts.retries ?? 1) + spare + relaySpare;
  let lastErr: unknown;
  // Once every Worker failed for this call, go direct (or through the proxy).
  let relayOff = false;
  let statusFailovers = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const useRelay = !relayOff && shouldRelay(url, opts);
    let doFetch: typeof fetch | null = null;
    try {
      const fetchUrl = useRelay ? rewriteViaRelay(url) : url;
      doFetch = useRelay ? null : opts.proxy ? await proxiedFetch() : null;
      const res = await (doFetch ?? fetch)(fetchUrl, {
        method: opts.method ?? "GET",
        body: opts.body,
        headers: {
          "user-agent": DESKTOP_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
          "accept-language": "en-US,en;q=0.9,ar;q=0.8",
          ...opts.headers,
        },
        redirect: "follow",
        signal: ctrl.signal,
        cache: "no-store",
      } as RequestInit);
      if (doFetch && res.status === 407 && attempt < retries && failoverProxy()) continue;
      // Caller-chosen statuses (e.g. Instagram 429) → try the next proxy in the list.
      if (doFetch && opts.failoverOn?.includes(res.status) && statusFailovers < spare && attempt < retries && failoverProxy()) {
        statusFailovers++;
        await res.body?.cancel().catch(() => undefined);
        logError("proxy", `HTTP ${res.status} from ${hostOf(url)} via proxy — switched to the next proxy`);
        continue;
      }
      const text = await res.text();
      if (useRelay && res.status >= 500 && attempt < retries) {
        recordRelayTry(url, res.status, false);
        logError("relay", `Worker returned HTTP ${res.status} for ${hostOf(url)}`);
        if (!failoverRelay()) relayOff = true;
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (useRelay) recordRelayTry(url, res.status, res.status < 400);
      // When relayed, res.url is the Worker URL — keep the original target for callers.
      return { status: res.status, text, headers: res.headers, url: useRelay ? url : res.url };
    } catch (e) {
      lastErr = e;
      const aborted = (e as Error)?.name === "AbortError";
      if (useRelay) {
        recordRelayTry(url, undefined, false);
        logError("relay", `Worker request failed for ${hostOf(url)}: ${aborted ? "timeout" : String((e as Error)?.message ?? e)}`);
        if (!failoverRelay()) relayOff = true;
      } else if (doFetch && !aborted) {
        logError("proxy", `Proxy connection failed for ${hostOf(url)}: ${String((e as Error)?.message ?? e)}`);
        failoverProxy();
      }
      if (attempt < retries) await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw new PlatformError("upstream_error", `Upstream request failed: ${String((lastErr as Error)?.message ?? lastErr)}`, 502);
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "?";
  }
};

/** Extract a JSON payload embedded in a <script id="..."> tag. */
export function extractScriptJson<T = unknown>(html: string, id: string): T | null {
  const re = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as T;
  } catch {
    return null;
  }
}

/** Collect "name=value" pairs from Set-Cookie headers into a Cookie header string. */
export function cookiesFrom(headers: Headers): string {
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  const list = anyHeaders.getSetCookie ? anyHeaders.getSetCookie() : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return list
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

export function looksLikeBotWall(html: string): boolean {
  // Real TikTok SSR pages mention a "captcha" API domain in the first 4KB
  // (`{"kind":"m","captcha":""}`) and also embed this script. Never treat those as a wall.
  if (/__UNIVERSAL_DATA_FOR_REHYDRATION__/.test(html)) return false;
  const head = html.slice(0, 4000);
  return /Just a moment\.\.\.|challenge-platform|Please wait\.\.\.|tiktok-verify-page|_wafchallengeid/i.test(head);
}

/**
 * SCRAPER_PROXY may hold one proxy or several separated by commas / whitespace / newlines.
 * The "active" one is used first; on a connection error or HTTP 407 we fail over to the next
 * and keep using whichever answered last.
 */
export function proxyList(raw = process.env.SCRAPER_PROXY ?? ""): string[] {
  return raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}
const pg = globalThis as unknown as { __frostlyProxyIdx?: number; __frostlyProxyKey?: string };
export function activeProxyIndex(): number {
  const list = proxyList();
  const key = list.join(",");
  if (pg.__frostlyProxyKey !== key) {
    pg.__frostlyProxyKey = key;
    pg.__frostlyProxyIdx = 0;
  }
  return list.length ? (pg.__frostlyProxyIdx ?? 0) % list.length : 0;
}
export function activeProxy(): string {
  const list = proxyList();
  return list.length ? list[activeProxyIndex()] : "";
}
function failoverProxy(): boolean {
  const list = proxyList();
  if (list.length < 2) return false;
  pg.__frostlyProxyIdx = (activeProxyIndex() + 1) % list.length;
  console.warn(`[proxy] failover -> #${pg.__frostlyProxyIdx}`);
  return true;
}
/** Parse proxy credentials for Chromium (--proxy-server + page.authenticate). */
export function proxyForBrowser(raw = activeProxy()): { server: string; username?: string; password?: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return null;
  }
}

const proxyFetchCache = new Map<string, typeof fetch>();
export async function proxiedFetch(override?: string): Promise<typeof fetch | null> {
  const url = override ? proxyList(override)[0] : activeProxy();
  if (!url) return null;
  const hit = proxyFetchCache.get(url);
  if (hit) return hit;
  const { ProxyAgent, fetch: ufetch } = await import("undici");
  const dispatcher = new ProxyAgent(url);
  const fn = ((input: string, init?: RequestInit) =>
    ufetch(input, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
  if (proxyFetchCache.size > 8) proxyFetchCache.clear();
  proxyFetchCache.set(url, fn);
  return fn;
}

/**
 * Streaming fetch (images / video) through the proxy list with failover, for Instagram CDNs.
 * Returns null when no proxy is configured or every proxy failed, so the caller can decide what to do.
 */
export async function proxiedStream(url: string, init: RequestInit): Promise<Response | null> {
  const list = proxyList();
  for (let i = 0; i < list.length; i++) {
    const f = await proxiedFetch();
    if (!f) return null;
    try {
      const res = await f(url, init);
      if ((res.status === 407 || res.status === 429) && i < list.length - 1) {
        await res.body?.cancel().catch(() => undefined);
        failoverProxy();
        continue;
      }
      return res;
    } catch (e) {
      logError("proxy", `Proxy media fetch failed for ${hostOf(url)}: ${String((e as Error)?.message ?? e)}`);
      if (!failoverProxy()) return null;
    }
  }
  return null;
}
