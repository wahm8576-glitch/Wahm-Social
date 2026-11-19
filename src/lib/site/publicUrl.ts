/**
 * Portable public site origin for webhooks and payment return URLs.
 * Never hardcode a host: prefer an admin/env override, else the request
 * host, else the current platform URL (e.g. Render).
 */
import { env } from "../env";
import { snapshot } from "./snapshot";

export function normalizeOrigin(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!u.host) return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

export function originFromHeaders(headers: { get(name: string): string | null } | Headers): string {
  const host = (headers.get("x-forwarded-host") || headers.get("host") || "").split(",")[0].trim();
  if (!host) return "";
  const proto = (headers.get("x-forwarded-proto") || (env.isProd ? "https" : "http")).split(",")[0].trim() || "https";
  return normalizeOrigin(`${proto}://${host}`);
}

export function originFromRequest(req?: Request): string {
  return req ? originFromHeaders(req.headers) : "";
}

/** Explicit operator-configured origin (admin publicUrl, SITE_URL, NEXT_PUBLIC_SITE_URL). Empty if unset. */
export function configuredOrigin(): string {
  try {
    const fromAdmin = normalizeOrigin(snapshot().settings?.publicUrl || "");
    if (fromAdmin) return fromAdmin;
  } catch {
    /* snapshot not ready */
  }
  // SITE_URL and the admin field pin the public origin. NEXT_PUBLIC_SITE_URL is
  // only a fallback in publicSiteUrl so a stale Render value does not block a
  // domain move.
  return normalizeOrigin(process.env.SITE_URL || "");
}

function renderOrigin(): string {
  return normalizeOrigin(process.env.RENDER_EXTERNAL_URL || "");
}

function isTrustedRequestOrigin(origin: string): boolean {
  if (!origin) return false;
  const configured = configuredOrigin();
  if (configured && origin === configured) return true;
  const render = renderOrigin();
  if (render && origin === render) return true;
  // On Render the platform overwrites X-Forwarded-Host with the domain that
  // actually reached the service (including a custom domain), so it is safe
  // to treat that origin as the live public URL when no admin override is set.
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) {
    if (!configured) return true;
    // Custom domain in front of the same service: allow https request hosts.
    try {
      return new URL(origin).protocol === "https:";
    } catch {
      return false;
    }
  }
  // Local/dev or a new host with nothing configured yet.
  return !configured;
}

/**
 * Public origin used for Telegram webhooks, PayPal/Stripe return URLs, and bot links.
 * Priority: admin publicUrl / SITE_URL / NEXT_PUBLIC_SITE_URL, else a trusted
 * request host, else RENDER_EXTERNAL_URL, else localhost.
 */
export function publicSiteUrl(req?: Request | { headers: { get(name: string): string | null } }): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  const fromReq = req ? originFromHeaders(req.headers) : "";
  if (fromReq && isTrustedRequestOrigin(fromReq)) return fromReq;
  return renderOrigin() || normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL || "") || normalizeOrigin(env.siteUrl) || "http://localhost:3000";
}

export function telegramWebhookUrl(req?: Request | { headers: { get(name: string): string | null } }): string {
  return `${publicSiteUrl(req)}/api/telegram/webhook`;
}

export function paypalWebhookUrl(req?: Request | { headers: { get(name: string): string | null } }): string {
  return `${publicSiteUrl(req)}/api/billing/paypal/webhook`;
}

export function billingReturnUrls(req?: Request) {
  const base = publicSiteUrl(req);
  return {
    returnUrl: `${base}/account?upgraded=1`,
    cancelUrl: `${base}/pricing?canceled=1`,
  };
}
