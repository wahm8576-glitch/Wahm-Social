/** Build new pool entries from panel form input (validated). */
import { newId } from "./ops";
import { normalizeProxyLine, validateProxy, validateRelay } from "./validate";
import type { IgCookies, PoolEntry, PoolKind } from "./types";
import { parseIgCookieEnv } from "../platforms/instagram/session/cookie-env";

const str = (f: FormData, k: string, max = 20_000) => String(f.get(k) ?? "").slice(0, max).trim();


export function buildEntries(kind: PoolKind, f: FormData): PoolEntry[] {
  const label = str(f, "label", 60);
  const base = (i: number, n: number): Pick<PoolEntry, "id" | "label" | "enabled" | "addedAt"> => ({
    id: newId(),
    label: label ? (n > 1 ? `${label} ${i + 1}` : label) : "",
    enabled: true,
    addedAt: new Date().toISOString(),
  });
  if (kind === "proxies" || kind === "relays") {
    const lines = str(f, "url").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) throw new Error("الصق الرابط أولاً");
    return lines.map((line, i) => {
      const url = kind === "proxies" ? normalizeProxyLine(line) : line.replace(/\/+$/, "");
      const bad = kind === "proxies" ? validateProxy(url) : validateRelay(url);
      if (bad) throw new Error(lines.length > 1 ? `سطر ${i + 1}: ${bad}` : bad);
      return { ...base(i, lines.length), url };
    });
  }
  if (kind === "tiktok") {
    const cookie = str(f, "cookie").replace(/^Cookie:\s*/i, "").replace(/\r/g, "");
    if (!cookie.includes("=") && !/^[A-Za-z0-9]{16,}$/.test(cookie)) throw new Error("الصق سطر الكوكيز كامل (فيه sessionid=…)");
    return [{ ...base(0, 1), cookie: cookie.includes("=") ? cookie : `sessionid=${cookie}` }];
  }
  const pasted = str(f, "cookie") || str(f, "sessionid", 2000);
  const bag = parseIgCookieEnv(pasted);
  const ig: IgCookies = {
    sessionid: bag.sessionid || str(f, "sessionid", 600),
    csrftoken: str(f, "csrftoken", 200) || bag.csrftoken || undefined,
    dsUserId: str(f, "dsUserId", 40) || bag.ds_user_id || undefined,
    mid: str(f, "mid", 200) || bag.mid || undefined,
    datr: str(f, "datr", 200) || bag.datr || undefined,
  };
  if (!ig.sessionid) throw new Error("sessionid مطلوب (أو الصق سطر الكوكيز كامل أو التوكن وحده)");
  return [{ ...base(0, 1), ig }];
}
