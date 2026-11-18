/**
 * Parse IG_SESSIONID whether it is a bare session token, a Cookie header,
 * or a Netscape-style export. Never log the values.
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

const ATTR = /^(domain|path|expires|max-age|secure|httponly|samesite|priority|size)$/i;

/** Strip wrapping quotes / leftover JSON braces from a pasted env value. */
export function stripCookieJunk(raw: string): string {
  let s = raw.trim().replace(/^Cookie:\s*/i, "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  s = s.replace(/["}\]]+$/g, "").trim();
  return s;
}

function setKey(bag: IgCookieBag, key: string, val: string) {
  const k = key.trim().toLowerCase();
  const v = val.trim();
  if (!k || !v || ATTR.test(k)) return;
  if (k === "sessionid") bag.sessionid = v;
  else if (k === "ds_user_id") bag.ds_user_id = v;
  else if (k === "csrftoken") bag.csrftoken = v;
  else if (k === "mid") bag.mid = v;
  else if (k === "datr") bag.datr = v;
  else if (k === "ig_did") bag.ig_did = v;
  else if (k === "rur") bag.rur = v;
  else if (k === "wd") bag.wd = v.replace(/["}\]]+$/g, "");
}

export function parseIgCookieEnv(raw: string): IgCookieBag {
  const s = stripCookieJunk(raw);
  const bag: IgCookieBag = { sessionid: "" };
  if (!s) return bag;
  // Bare token (no separators).
  if (!/[;=\n]/.test(s)) {
    bag.sessionid = s.trim();
    return bag;
  }
  const parts = s.split(/[;\n\r]+/).map((p) => p.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("#")) continue;
    if (!p.includes("=")) {
      if (i === 0 && !bag.sessionid && !/\s/.test(p)) bag.sessionid = p;
      continue;
    }
    const m = p.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    setKey(bag, m[1], m[2].replace(/;.*$/, "").trim());
  }
  return bag;
}

export function igSessionToken(raw: string): string {
  return parseIgCookieEnv(raw).sessionid;
}

/** Safe log tag: label + last 4 characters of the session token only. */
export function sessionTag(label: string | undefined, token: string | undefined, id?: string): string {
  const t = (token ?? "").replace(/[^A-Za-z0-9]/g, "");
  const last = t.slice(-4) || "????";
  return `${label || id || "session"} …${last}`;
}
