/**
 * Media proxy helpers. Only whitelisted platform CDNs may be proxied, which
 * prevents this server from being abused as an open proxy (SSRF).
 */
import { DESKTOP_UA, isInstagramHost, proxiedStream, proxyList } from "./http";
import { PlatformError } from "../platforms/types";

const ALLOWED_HOST_SUFFIXES = [
  ".tiktokcdn.com",
  ".tiktokcdn-us.com",
  ".tiktokcdn-eu.com",
  ".tiktok.com",
  ".tiktokv.com",
  ".tiktokv.us",
  ".tikwm.com",
  ".ibyteimg.com",
  ".byteoversea.com",
  ".muscdn.com",
  ".cdninstagram.com",
  ".fbcdn.net",
  ".instagram.com",
];

export function isAllowedMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s));
  } catch {
    return false;
  }
}

function refererFor(url: string) {
  if (/instagram|fbcdn/.test(url)) return "https://www.instagram.com/";
  if (/tikwm\.com/.test(url)) return "https://www.tikwm.com/";
  return "https://www.tiktok.com/";
}

export async function fetchMedia(url: string, opts: { cookie?: string; range?: string | null } = {}) {
  if (!isAllowedMediaUrl(url)) throw new PlatformError("invalid_input", "Media host not allowed", 400);
  const headers: Record<string, string> = { "user-agent": DESKTOP_UA, referer: refererFor(url), accept: "*/*" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.range) headers.range = opts.range;
  const init = { headers, redirect: "follow", cache: "no-store" } as RequestInit;
  // Instagram CDN media also goes through the proxy list (set IG_MEDIA_VIA_PROXY=0 to save proxy bandwidth).
  // Direct only as a last resort when every proxy failed to connect, so images never just break.
  const viaProxy = isInstagramHost(url) && process.env.IG_MEDIA_VIA_PROXY !== "0" && proxyList().length > 0;
  const res = (viaProxy ? await proxiedStream(url, init) : null) ?? (await fetch(url, init));
  if (!res.ok && res.status !== 206) throw new PlatformError("upstream_error", `Media fetch failed (${res.status})`, 502);
  return res;
}

export function safeFilename(s: string) {
  return (s || "wahm").replace(/[^\w.\-]+/g, "_").slice(0, 80);
}

export function streamResponse(upstream: Response, opts: { filename?: string; inline?: boolean; cacheSeconds?: number } = {}) {
  const h = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(k);
    if (v) h.set(k, v);
  }
  if (opts.filename) h.set("content-disposition", `${opts.inline ? "inline" : "attachment"}; filename="${safeFilename(opts.filename)}"`);
  h.set("cache-control", opts.cacheSeconds ? `public, max-age=${opts.cacheSeconds}` : "private, no-store");
  h.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers: h });
}

export { proxied } from "../mediaUrl";
