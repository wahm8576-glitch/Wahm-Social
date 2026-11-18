/** Read pools from the secrets bag; when a pool was never saved, seed it from the current env values. */
import type { PoolEntry, PoolKind } from "./types";
import { poolSecretKey } from "./types";
import { parseIgCookieEnv } from "../platforms/instagram/session/cookie-env";

const splitList = (raw: string) => raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

function sanitize(kind: PoolKind, x: unknown, i: number): PoolEntry | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const e: PoolEntry = {
    id: typeof o.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : `e${i}`,
    label: typeof o.label === "string" ? o.label.slice(0, 60) : "",
    enabled: o.enabled !== false,
    addedAt: typeof o.addedAt === "string" ? o.addedAt : undefined,
  };
  if (kind === "proxies" || kind === "relays") {
    if (typeof o.url !== "string" || !o.url) return null;
    e.url = o.url;
  } else if (kind === "tiktok") {
    if (typeof o.cookie !== "string" || !o.cookie) return null;
    e.cookie = o.cookie;
  } else {
    const ig = o.ig as Record<string, unknown> | undefined;
    if (!ig || typeof ig.sessionid !== "string" || !ig.sessionid) return null;
    const s = (k: string) => (typeof ig[k] === "string" && ig[k] ? (ig[k] as string) : undefined);
    e.ig = { sessionid: ig.sessionid, csrftoken: s("csrftoken"), dsUserId: s("dsUserId"), mid: s("mid"), datr: s("datr") };
  }
  return e;
}

/** Stored pool, or null when it was never saved from the panel. */
export function storedPool(secrets: Record<string, string>, kind: PoolKind): PoolEntry[] | null {
  const raw = secrets[poolSecretKey(kind)];
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((x, i) => sanitize(kind, x, i)).filter((x): x is PoolEntry => !!x);
  } catch {
    return null;
  }
}

/** Entries implied by the env values currently in effect (Render or legacy single fields). */
export function seedFromEnv(kind: PoolKind, env: NodeJS.ProcessEnv = process.env): PoolEntry[] {
  if (kind === "proxies") return splitList(env.SCRAPER_PROXY ?? "").map((url, i) => ({ id: `env${i}`, label: `من Render #${i + 1}`, enabled: true, url }));
  if (kind === "relays") return splitList(env.RELAY_URL ?? "").map((url, i) => ({ id: `env${i}`, label: `من Render #${i + 1}`, enabled: true, url }));
  if (kind === "tiktok") {
    const cookie = env.TIKTOK_COOKIE || (env.TIKTOK_SESSIONID ? `sessionid=${env.TIKTOK_SESSIONID}` : "");
    return cookie ? [{ id: "env0", label: "الجلسة الحالية", enabled: true, cookie }] : [];
  }
  if (!env.IG_SESSIONID) return [];
  const bag = parseIgCookieEnv(env.IG_SESSIONID);
  const sessionid = bag.sessionid || env.IG_SESSIONID;
  if (!sessionid || sessionid.includes(";")) return [];
  return [
    {
      id: "env0",
      label: "من Render",
      enabled: true,
      ig: {
        sessionid,
        csrftoken: env.IG_CSRFTOKEN || bag.csrftoken || undefined,
        dsUserId: env.IG_DS_USER_ID || bag.ds_user_id || undefined,
        mid: env.IG_MID || bag.mid || undefined,
        datr: env.IG_DATR || bag.datr || undefined,
      },
    },
  ];
}

export const enabledEntries = (list: PoolEntry[] | null) => (list ?? []).filter((e) => e.enabled);


function tokenOf(kind: PoolKind, e: PoolEntry): string {
  if (kind === "instagram") return (e.ig?.sessionid ?? "").trim();
  if (kind === "tiktok") {
    const c = e.cookie ?? "";
    const m = c.match(/(?:^|;\s*)sessionid=([^;]+)/i);
    return (m ? m[1] : c).trim();
  }
  return (e.url ?? "").trim();
}

/**
 * Stored pool (if saved) plus the Render env session when its token is not already in the list.
 */
export function mergedPool(secrets: Record<string, string>, kind: PoolKind, env: NodeJS.ProcessEnv = process.env): PoolEntry[] {
  const stored = storedPool(secrets, kind);
  const fromEnv = seedFromEnv(kind, env);
  if (!stored) return fromEnv;
  const have = new Set(stored.map((e) => tokenOf(kind, e)).filter(Boolean));
  const extra = fromEnv.filter((e) => {
    const t = tokenOf(kind, e);
    return t && !have.has(t);
  });
  return extra.length ? [...stored, ...extra] : stored;
}
