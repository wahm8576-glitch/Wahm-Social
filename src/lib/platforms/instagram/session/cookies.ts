import "server-only";
/**
 * Builds the Instagram request headers from the server's own session env vars
 * (IG_SESSIONID, IG_CSRFTOKEN, IG_DS_USER_ID, IG_MID, IG_DATR).
 * Values are never logged or returned to clients.
 */
import { env } from "../../../env";
import { parseIgCookieEnv } from "./cookie-env";
import type { IgCookies } from "../../../pools/types";
import { currentList } from "../../../pools/ops";
import { snapshot } from "../../../site/snapshot";

export const IG_WEB_APP_ID = "936619743392459";
export const IG_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export const IG_ANDROID_UA =
  "Instagram 309.1.0.41.113 Android (33/13; 420dpi; 1080x2340; samsung; SM-S911B; dm1q; qcom; en_US; 541635890)";

export const hasSession = () => {
  if (env.igSessionId) return true;
  try {
    return currentList(snapshot().secrets, "instagram").some((e) => e.enabled && !!e.ig?.sessionid);
  } catch {
    return false;
  }
};

function bag() {
  return parseIgCookieEnv(process.env.IG_SESSIONID ?? "");
}

function dsUserId(): string {
  if (env.igDsUserId) return env.igDsUserId;
  if (bag().ds_user_id) return bag().ds_user_id!;
  // A session id starts with the numeric user id ("123%3A..." or "123:...").
  return decodeURIComponent(env.igSessionId).split(":")[0].replace(/\D/g, "");
}

export function cookieHeader(): string {
  if (!env.igSessionId) return "";
  const extra = bag();
  const parts: [string, string][] = [
    ["sessionid", env.igSessionId],
    ["ds_user_id", dsUserId()],
    ["csrftoken", env.igCsrfToken || extra.csrftoken || ""],
    ["mid", env.igMid || extra.mid || ""],
    ["datr", env.igDatr || extra.datr || ""],
    ["ig_did", extra.ig_did || ""],
    ["ig_nrcb", "1"],
  ];
  return parts.filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ");
}

export type IgClient = "web-session" | "app-session" | "web-anon";

function cookieHeaderFrom(ig: IgCookies): string {
  const ds = ig.dsUserId || decodeURIComponent(ig.sessionid).split(":")[0].replace(/\D/g, "");
  const parts: [string, string][] = [
    ["sessionid", ig.sessionid],
    ["ds_user_id", ds],
    ["csrftoken", ig.csrftoken || ""],
    ["mid", ig.mid || ""],
    ["datr", ig.datr || ""],
    ["ig_nrcb", "1"],
  ];
  return parts.filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ");
}

export function igHeaders(client: IgClient, referer = "https://www.instagram.com/", ig?: IgCookies | null): Record<string, string> {
  const h: Record<string, string> = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "x-ig-app-id": IG_WEB_APP_ID,
    "x-asbd-id": "129477",
    "x-requested-with": "XMLHttpRequest",
    "x-ig-www-claim": "0",
    referer,
    origin: "https://www.instagram.com",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "user-agent": client === "app-session" ? IG_ANDROID_UA : IG_DESKTOP_UA,
  };
  if (client === "app-session") h["x-ig-app-id"] = "567067343352427";
  if (client !== "web-anon") {
    if (ig?.sessionid) {
      h.cookie = cookieHeaderFrom(ig);
      if (ig.csrftoken) h["x-csrftoken"] = ig.csrftoken;
    } else if (env.igSessionId) {
      h.cookie = cookieHeader();
      if (env.igCsrfToken) h["x-csrftoken"] = env.igCsrfToken;
    }
  }
  return h;
}

export const hasIgSession = hasSession;

/** IG cookies for a Chromium session (Puppeteer page.setCookie). */
export function igSessionCookies(): { name: string; value: string; domain: string; path: string }[] {
  const extra = bag();
  const pairs: [string, string | undefined][] = [
    ["sessionid", env.igSessionId],
    ["ds_user_id", dsUserId()],
    ["csrftoken", env.igCsrfToken || extra.csrftoken],
    ["mid", env.igMid || extra.mid],
    ["datr", env.igDatr || extra.datr],
    ["ig_did", extra.ig_did],
    ["ig_nrcb", "1"],
  ];
  return pairs.filter(([, v]) => v).map(([name, value]) => ({ name, value: value as string, domain: ".instagram.com", path: "/" }));
}
