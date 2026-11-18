/**
 * Parse IG_SESSIONID whether it is a bare session token or a pasted cookie header.
 * Never log the values.
 */
export interface IgCookieBag {
  sessionid: string;
  ds_user_id?: string;
  csrftoken?: string;
  mid?: string;
  datr?: string;
  ig_did?: string;
  rur?: string;
  wd?: string;
}

/** Strip wrapping quotes / leftover JSON braces from a pasted env value. */
export function stripCookieJunk(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  // Pasted JSON fragments sometimes leave trailing `"}}` or `"}]` after the last cookie.
  s = s.replace(/["}\]]+$/g, "").trim();
  return s;
}

export function parseIgCookieEnv(raw: string): IgCookieBag {
  const s = stripCookieJunk(raw);
  if (!s) return { sessionid: "" };
  if (!s.includes(";")) return { sessionid: s.trim() };

  const bag: IgCookieBag = { sessionid: "" };
  const parts = s.split(";").map((p) => p.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.includes("=")) {
      if (i === 0 && !bag.sessionid) bag.sessionid = p;
      continue;
    }
    const eq = p.indexOf("=");
    const key = p.slice(0, eq).trim().toLowerCase();
    const val = p.slice(eq + 1).trim();
    if (!val) continue;
    if (key === "sessionid") bag.sessionid = val;
    else if (key === "ds_user_id") bag.ds_user_id = val;
    else if (key === "csrftoken") bag.csrftoken = val;
    else if (key === "mid") bag.mid = val;
    else if (key === "datr") bag.datr = val;
    else if (key === "ig_did") bag.ig_did = val;
    else if (key === "rur") bag.rur = val;
    else if (key === "wd") bag.wd = val;
    else if (i === 0 && !bag.sessionid && key !== "sessionid") {
      /* first segment with an unexpected key: ignore */
    }
  }
  return bag;
}

export function igSessionToken(raw: string): string {
  return parseIgCookieEnv(raw).sessionid;
}
