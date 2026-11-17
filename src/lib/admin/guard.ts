import "server-only";
import { NextResponse } from "next/server";
import { isAdmin } from "./session";
import { adminHref } from "./path";
import { env } from "../env";

/** Same-origin check for panel POSTs (cookie is SameSite=Strict too). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl) — the session cookie still has to be valid
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  // Safari (and the Fetch spec) send `Origin: null` on form POSTs from a page with
  // Referrer-Policy: no-referrer. Trust the browser's own Sec-Fetch-Site in that case.
  if (origin === "null") return site === "same-origin" || site === null;
  try {
    const o = new URL(origin).host;
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    return o === host || o === new URL(env.siteUrl).host;
  } catch {
    return false;
  }
}

/** Redirect (303) back into the panel with a flash message in the query string. */
export function back(req: Request, sub: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = NextResponse.redirect(new URL(`${adminHref(sub)}${qs ? `?${qs}` : ""}`, publicOrigin(req)), 303);
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (env.isProd ? "https" : "http");
  return host ? `${proto}://${host}` : env.siteUrl;
}

/** Wrap a panel POST handler: origin + session check, uniform error flash. */
export function adminAction(sub: string, fn: (req: Request, form: FormData) => Promise<Response | string | void>) {
  return async (req: Request) => {
    if (!sameOrigin(req) || !(await isAdmin())) return new NextResponse("Not found", { status: 404 });
    try {
      const form = await req.formData();
      const out = await fn(req, form);
      if (out instanceof Response) return out;
      return back(req, sub, { ok: typeof out === "string" ? out : "تم الحفظ ✅" });
    } catch (e) {
      return back(req, sub, { err: (e as Error).message.slice(0, 300) || "خطأ" });
    }
  };
}
