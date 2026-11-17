/**
 * Frostly relay — Cloudflare Worker (free plan is enough).
 * Deploy: Cloudflare dashboard → Workers & Pages → Create → "Hello World" → paste this file → Deploy,
 * then put the worker URL (https://<name>.<account>.workers.dev) in RELAY_URL on Render or in the admin panel.
 *
 * Protocol: GET https://<worker>/?u=<urlencoded https URL>
 * Only GET, only the hosts below, no cookies forwarded (public data only — never a session).
 */
const ALLOWED_HOSTS = new Set([
  "www.tiktok.com",
  "tiktok.com",
  "www.tikwm.com",
  "tikwm.com",
  "countik.com",
  "www.instagram.com",
  "i.instagram.com",
  "dumpor.io",
]);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export default {
  async fetch(request) {
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
    const target = new URL(request.url).searchParams.get("u");
    let url;
    try {
      url = new URL(target || "");
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return new Response("blocked host", { status: 403 });
    const pass = ["accept", "accept-language", "referer", "x-ig-app-id", "x-requested-with", "user-agent"];
    const headers = new Headers();
    for (const h of pass) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has("user-agent")) headers.set("user-agent", UA);
    const res = await fetch(url.toString(), { headers, redirect: "follow", cf: { cacheTtl: 0 } });
    const out = new Headers({ "content-type": res.headers.get("content-type") || "text/plain", "x-relay-status": String(res.status) });
    return new Response(res.body, { status: res.status, headers: out });
  },
};
