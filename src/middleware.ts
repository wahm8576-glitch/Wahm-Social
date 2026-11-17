import { NextResponse, type NextRequest } from "next/server";

/**
 * Secret admin panel routing.
 *  /<ADMIN_PATH>/…  → rewritten to the internal route folder (/cpanel-internal/…)
 *  /cpanel-internal…, /admin, /api/admin/… and other guessable panel paths → 404
 */
const INTERNAL = "/cpanel-internal";
const GUESSABLE = /^\/(admin|administrator|wp-admin|wp-login\.php|cpanel|dashboard|panel|control|controlpanel|backend|manage|api\/admin)(\/|$)/i;

function notFound(req: NextRequest) {
  const res = NextResponse.rewrite(new URL("/__not-found__", req.url));
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const slug = (process.env.ADMIN_PATH || "").replace(/^\/+|\/+$/g, "");
  const valid = /^[A-Za-z0-9_-]{16,}$/.test(slug);

  if (pathname === INTERNAL || pathname.startsWith(INTERNAL + "/")) return notFound(req);
  if (valid && (pathname === `/${slug}` || pathname.startsWith(`/${slug}/`))) {
    const rest = pathname.slice(slug.length + 1);
    // No session cookie at all → straight to the login screen (real verification happens server-side).
    if (!req.cookies.has("frostly_cp") && rest !== "/login" && !rest.startsWith("/api/")) {
      const login = req.nextUrl.clone();
      login.pathname = `/${slug}/login`;
      login.search = "";
      return NextResponse.redirect(login, 307);
    }
    const url = req.nextUrl.clone();
    url.pathname = INTERNAL + rest;
    const headers = new Headers(req.headers);
    headers.set("x-frostly-cp", "1");
    const res = NextResponse.rewrite(url, { request: { headers } });
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.headers.set("Cache-Control", "no-store");
    // "same-origin": no referrer leaves the site, but the panel's own form POSTs keep a real Origin header.
    res.headers.set("Referrer-Policy", "same-origin");
    return res;
  }
  if (GUESSABLE.test(pathname)) return notFound(req);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|hero|frostly-app-icon).*)"],
};
