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
  /** Which active-proxy pointer to use/advance (Instagram has its own). */
  channel?: ProxyChannel;
  /** Fallback chain: healthy proxies → direct → Worker relay (short timeouts per step). */
  chain?: boolean;
  /** Skip the Worker relay inside baseGet (the chain adds it as its own last step). */
  noRelay?: boolean;
  /** Cap proxy failovers within one call. */
  maxFailovers?: number;
}

export interface FetchResult {
  status: number;
  text: string;
  headers: Headers;
  url: string;
  /** Which route answered (set by the fallback chain). */
  via?: "proxy" | "direct" | "relay";
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
 * Instagram: healthy proxies first (429 / connection errors fail over, capped), then a DIRECT request
 * from the server, then the Cloudflare Worker relay. Short timeouts so a page never hangs.
 */
async function instagramGet(url: string, opts: FetchOptions): Promise<FetchResult> {
  return chainGet(url, { ...opts, failoverOn: [...new Set([...(opts.failoverOn ?? []), 429])] }, igRefused, "ig");
}

/** Generic "refused" for public pages/APIs: rate limit, server errors, Cloudflare / WAF challenge. */
export function pageRefused(r: FetchResult): boolean {
  return r.status === 403 || r.status === 429 || r.status >= 500 || looksLikeBotWall(r.text);
}

/**
 * Fallback chain used for Instagram and every public data source:
 *  1. proxies (only if at least one is healthy; at most 2 proxies per call),
 *  2. direct from the server IP,
 *  3. Cloudflare Worker relay (GET without cookies only).
 * Returns the first answer that is not "refused"; otherwise the best refused answer (so callers can classify it).
 */
export async function chainGet(url: string, opts: FetchOptions, refused: (r: FetchResult) => boolean = pageRefused, channel: ProxyChannel = opts.channel ?? "main"): Promise<FetchResult> {
  const t = opts.timeoutMs ?? 12000;
  let last: FetchResult | undefined;
  let err: unknown;
  if (proxyList().length && healthyProxyCount(channel) > 0) {
    try {
      const r = await baseGet(url, { ...opts, proxy: true, channel, retries: 0, noRelay: true, maxFailovers: 1, timeoutMs: Math.min(t, 7000) });
      if (!refused(r)) return { ...r, via: "proxy" };
      last = { ...r, via: "proxy" };
    } catch (e) {
      err = e;
    }
  }
  try {
    const r = await baseGet(url, { ...opts, proxy: false, retries: 0, noRelay: true, timeoutMs: Math.min(t, 6000) });
    if (!refused(r)) return { ...r, via: "direct" };
    last = last ?? { ...r, via: "direct" };
  } catch (e) {
    err = err ?? e;
  }
  if (relayList().length && canRelayRequest(opts)) {
    const r = await relayGet(url, { ...opts, timeoutMs: Math.min(t, 8000) }).catch(() => undefined);
    if (r && !refused(r)) return { ...r, via: "relay" };
    if (r) last = last ?? { ...r, via: "relay" };
  }
  if (last) return last;
  throw err instanceof Error ? err : new PlatformError("upstream_error", "Request failed via proxies, direct and Worker", 502);
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

/** Public data hosts that use the proxy → direct → relay chain unless the caller picked a route. */
const CHAIN_HOSTS = /(^|\.)(tiktok\.com|tikwm\.com|countik\.com|dumpor\.io)$/i;

export async function httpGet(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  if (isInstagramHost(url)) return instagramGet(url, opts);
  if (opts.chain || (opts.proxy === undefined && CHAIN_HOSTS.test(hostOf(url)))) return chainGet(url, opts);
  return baseGet(url, opts);
}

async function baseGet(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const { timeoutMs = 12000 } = opts;
  const ch: ProxyChannel = opts.channel ?? "main";
  // One extra attempt per spare proxy / spare Worker so a dead one fails over within the same call.
  // Cap failovers per call so a long list of bad proxies can never stall a page (cooldowns skip them next time).
  const spare = opts.proxy ? Math.min(opts.maxFailovers ?? 3, Math.max(0, proxyList().length - 1)) : 0;
  const relaySpare = !opts.noRelay && shouldRelay(url, opts) ? relayList().length : 0;
  const retries = (opts.retries ?? 1) + spare + relaySpare;
  let lastErr: unknown;
  // Once every Worker failed for this call, go direct (or through the proxy).
  let relayOff = false;
  let statusFailovers = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const useRelay = !opts.noRelay && !relayOff && shouldRelay(url, opts);
    let doFetch: typeof fetch | null = null;
    try {
      const fetchUrl = useRelay ? rewriteViaRelay(url) : url;
      doFetch = useRelay ? null : opts.proxy ? await proxiedFetch(undefined, ch) : null;
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
      if (doFetch && res.status === 407 && attempt < retries && failoverProxy(ch, "error")) continue;
      // Caller-chosen statuses (e.g. Instagram 429) → try the next proxy in the list.
      if (doFetch && opts.failoverOn?.includes(res.status) && statusFailovers < spare && attempt < retries && failoverProxy(ch, "status")) {
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
      } else if (doFetch) {
        logError("proxy", `Proxy ${aborted ? "timeout" : "connection failed"} for ${hostOf(url)}${aborted ? "" : `: ${String((e as Error)?.message ?? e)}`}`);
        failoverProxy(ch, "error");
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
/**
 * Proxy health, per channel ("ig" for Instagram, "main" for everything else).
 * - Each channel keeps a sticky "current" proxy (list order = preference).
 * - A proxy that errors / times out / answers 407 or 429 is put on a short cooldown for that channel
 *   and the next healthy one is used immediately. Cooled-down proxies are skipped until they expire;
 *   if every proxy is cooling, the one that recovers first is used.
 */
export type ProxyChannel = "main" | "ig";
const COOLDOWN_MS = { error: 3 * 60_000, status: 90_000 };
const pg = globalThis as unknown as {
  __frostlyProxyCur?: Record<ProxyChannel, number>;
  __frostlyProxyKey?: string;
  __frostlyProxyBad?: Map<string, number>;
};
function state() {
  const list = proxyList();
  const key = list.join(",");
  if (pg.__frostlyProxyKey !== key || !pg.__frostlyProxyCur || !pg.__frostlyProxyBad) {
    pg.__frostlyProxyKey = key;
    pg.__frostlyProxyCur = { main: 0, ig: 0 };
    pg.__frostlyProxyBad = new Map();
  }
  return { list, cur: pg.__frostlyProxyCur, bad: pg.__frostlyProxyBad };
}
const coolKey = (ch: ProxyChannel, url: string) => `${ch}|${url}`;
function cooling(ch: ProxyChannel, url: string, now = Date.now()): boolean {
  const until = state().bad.get(coolKey(ch, url));
  return until !== undefined && until > now;
}
/** Index of the proxy a channel should use now (sticky current unless it is cooling down). */
export function activeProxyIndex(channel: ProxyChannel = "main"): number {
  const { list, cur, bad } = state();
  if (!list.length) return 0;
  const now = Date.now();
  const start = (cur[channel] ?? 0) % list.length;
  for (let i = 0; i < list.length; i++) {
    const idx = (start + i) % list.length;
    if (!cooling(channel, list[idx], now)) {
      cur[channel] = idx;
      return idx;
    }
  }
  // Everything is cooling: take the one that recovers first.
  let best = start;
  let bestUntil = Infinity;
  list.forEach((u, idx) => {
    const until = bad.get(coolKey(channel, u)) ?? 0;
    if (until < bestUntil) (bestUntil = until), (best = idx);
  });
  return best;
}
export function activeProxy(channel: ProxyChannel = "main"): string {
  const list = proxyList();
  return list.length ? list[activeProxyIndex(channel)] : "";
}
/** Healthy (not cooling) proxy count for a channel — for diagnostics. */
export function healthyProxyCount(channel: ProxyChannel = "main"): number {
  return proxyList().filter((u) => !cooling(channel, u)).length;
}
/** Move a channel to its next proxy (current one cools down briefly). For callers that judge "bad" themselves. */
export function nextProxy(channel: ProxyChannel = "main"): boolean {
  return failoverProxy(channel, "status");
}
/** Put the current proxy of a channel on cooldown and move to the next healthy one. */
function failoverProxy(channel: ProxyChannel = "main", kind: "error" | "status" = "error"): boolean {
  const { list, cur, bad } = state();
  if (list.length < 2) return false;
  const idx = activeProxyIndex(channel);
  bad.set(coolKey(channel, list[idx]), Date.now() + COOLDOWN_MS[kind]);
  cur[channel] = (idx + 1) % list.length;
  const next = activeProxyIndex(channel);
  console.warn(`[proxy] ${channel} #${idx + 1} cooling (${kind}) -> #${next + 1}`);
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
export async function proxiedFetch(override?: string, channel: ProxyChannel = "main"): Promise<typeof fetch | null> {
  const url = override ? proxyList(override)[0] : activeProxy(channel);
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
export async function proxiedStream(url: string, init: RequestInit, channel: ProxyChannel = "ig"): Promise<Response | null> {
  const list = proxyList();
  const tries = Math.min(list.length, 3);
  for (let i = 0; i < tries; i++) {
    const f = await proxiedFetch(undefined, channel);
    if (!f) return null;
    // Time-limit only the wait for response headers (the body may be a long video stream).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await f(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if ((res.status === 407 || res.status === 429) && i < tries - 1) {
        await res.body?.cancel().catch(() => undefined);
        failoverProxy(channel, res.status === 429 ? "status" : "error");
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      logError("proxy", `Proxy media fetch failed for ${hostOf(url)}: ${String((e as Error)?.message ?? e)}`);
      if (!failoverProxy(channel, "error")) return null;
    }
  }
  return null;
}
