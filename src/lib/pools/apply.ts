/** Write pools onto process.env (SCRAPER_PROXY, RELAY_URL, TIKTOK_COOKIE, IG_*). Called from applyOverrides. */
import { enabledEntries, storedPool, mergedPool } from "./read";
import { activeIndex, advance } from "./rotate";
import { pickSession } from "./runtime";
import type { PoolKind } from "./types";

const setEnv = (k: string, v: string | undefined) => {
  if (v === undefined || v === "") delete process.env[k];
  else process.env[k] = v;
};

export function applyPools(secrets: Record<string, string>) {
  const proxies = storedPool(secrets, "proxies");
  if (proxies) setEnv("SCRAPER_PROXY", enabledEntries(proxies).map((e) => e.url).join(","));

  const relays = storedPool(secrets, "relays");
  if (relays) setEnv("RELAY_URL", enabledEntries(relays).map((e) => e.url).join(","));

  const tt = storedPool(secrets, "tiktok");
  if (tt) {
    const on = enabledEntries(tt);
    const cur = pickSession("tiktok", on) ?? on[activeIndex("tiktok", on.length)];
    setEnv("TIKTOK_COOKIE", cur?.cookie);
    if (!cur) setEnv("TIKTOK_SESSIONID", undefined);
  }

  const ig = storedPool(secrets, "instagram");
  if (ig) {
    const on = enabledEntries(ig);
    const c = (pickSession("instagram", on) ?? on[activeIndex("instagram", on.length)])?.ig;
    setEnv("IG_SESSIONID", c?.sessionid);
    setEnv("IG_CSRFTOKEN", c?.csrftoken);
    setEnv("IG_DS_USER_ID", c?.dsUserId);
    setEnv("IG_MID", c?.mid);
    setEnv("IG_DATR", c?.datr);
  }
}

const g = globalThis as unknown as { __frostlySite?: { secrets?: Record<string, string> } };

/** Switch to the next enabled session of a pool (only when it has 2+). Returns true if rotated. */
export function rotateSession(kind: Extract<PoolKind, "tiktok" | "instagram">, reason: string): boolean {
  const secrets = g.__frostlySite?.secrets ?? {};
  const on = enabledEntries(storedPool(secrets, kind));
  if (on.length < 2) return false;
  const to = advance(kind, on.length);
  applyPools(secrets);
  console.warn(`[pool] ${kind} session rotated -> #${to + 1} (${reason})`);
  return true;
}

export function activeSessionNumber(kind: Extract<PoolKind, "tiktok" | "instagram">): { active: number; total: number } {
  const on = enabledEntries(mergedPool(g.__frostlySite?.secrets ?? {}, kind));
  return { active: on.length ? activeIndex(kind, on.length) + 1 : 0, total: on.length };
}
