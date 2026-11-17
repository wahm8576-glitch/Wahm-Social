import "server-only";
/** Low-level probes used by the per-entry test buttons. Results carry statuses only — never secrets. */
import { DESKTOP_UA, looksLikeBotWall } from "../server/http";
import { thirdPartyBlocked } from "../platforms/tiktok/fallback-http";
import { maskIp } from "./mask";

export type Verdict = "ok" | "blocked" | "error" | "warn";
export interface ProbeLine {
  target: string;
  verdict: Verdict;
  status?: number;
  ms: number;
  note?: string;
}

type F = typeof fetch;

async function timed(f: F, url: string, init: RequestInit, ms = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const res = await f(url, { ...init, signal: ctrl.signal, cache: "no-store", redirect: "follow" } as RequestInit);
    const text = await res.text();
    return { res, text, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const errLine = (target: string, e: unknown, t0: number): ProbeLine => ({
  target,
  verdict: "error",
  ms: Date.now() - t0,
  note: (e as Error).name === "AbortError" ? "timeout" : String((e as Error).message ?? e).replace(/\/\/[^@\s]*@/g, "//***@").slice(0, 80),
});

export async function probeIp(f: F): Promise<ProbeLine> {
  const t0 = Date.now();
  try {
    const { res, text, ms } = await timed(f, "https://api.ipify.org?format=json", { headers: { accept: "application/json" } }, 10_000);
    const ip = (text.match(/"ip"\s*:\s*"([^"]+)"/) ?? [])[1] ?? "";
    return { target: "IP الخروج", verdict: ip ? "ok" : "warn", status: res.status, ms, note: ip ? maskIp(ip) : "?" };
  } catch (e) {
    return errLine("IP الخروج", e, t0);
  }
}

/** Is the TikTok session cookie still signed in? (passport account info; returns yes/no only.) */
export async function probeTikTokLogin(f: F, cookie: string): Promise<ProbeLine> {
  const t0 = Date.now();
  try {
    const { res, text, ms } = await timed(f, "https://www.tiktok.com/passport/web/account/info/?aid=1459&app_language=en&device_platform=web_pc", {
      headers: { "user-agent": DESKTOP_UA, accept: "application/json", referer: "https://www.tiktok.com/", cookie },
    });
    let loggedIn = false;
    let msg = "";
    try {
      const j = JSON.parse(text);
      loggedIn = Boolean(j?.data?.user_id || j?.data?.user_id_str || j?.data?.username);
      msg = String(j?.data?.description || j?.message || "").slice(0, 60);
    } catch {
      msg = text.length ? "رد غير JSON" : "رد فاضي";
    }
    return {
      target: "جلسة تيك توك",
      verdict: loggedIn ? "ok" : "blocked",
      status: res.status,
      ms,
      note: loggedIn ? "مسجّلة دخول ✅" : `منتهية/غير مسجّلة ❌${msg ? ` (${msg})` : ""}`,
    };
  } catch (e) {
    return errLine("جلسة تيك توك", e, t0);
  }
}

/** TikTok profile page; returns secUid (public id) for the countik probe. */
export async function probeTikTok(f: F, cookie?: string, target = "https://www.tiktok.com/@tiktok?lang=en"): Promise<ProbeLine & { secUid?: string; loggedIn?: boolean }> {
  const t0 = Date.now();
  try {
    const { res, text, ms } = await timed(f, target, { headers: { "user-agent": DESKTOP_UA, accept: "text/html", "accept-language": "en-US,en;q=0.9", ...(cookie ? { cookie } : {}) } });
    const real = text.includes("webapp.user-detail") && text.includes('"secUid"');
    const secUid = (text.match(/"secUid":"([^"]+)"/) ?? [])[1];
    const uid = (text.match(/"webapp\.app-context":\{[\s\S]{0,4000}?"user":\{[\s\S]{0,400}?"uid":"(\d+)"/) ?? [])[1];
    const loggedIn = Boolean(uid && uid !== "0");
    const blocked = !real && (looksLikeBotWall(text) || /_wafchallengeid|tiktok-verify-page/i.test(text.slice(0, 20000)) || res.status === 403);
    return {
      target: "tiktok.com",
      verdict: real ? "ok" : blocked ? "blocked" : "warn",
      status: res.status,
      ms,
      note: real ? (cookie ? (loggedIn ? "مسجّل دخول ✅" : "الجلسة ما سجلت دخول ❌") : "بيانات الحساب وصلت") : blocked ? "صفحة تحقق (WAF)" : "بدون بيانات",
      secUid,
      loggedIn,
    };
  } catch (e) {
    return errLine("tiktok.com", e, t0);
  }
}

export async function probeTikwm(f: F): Promise<ProbeLine> {
  const t0 = Date.now();
  try {
    const { res, text, ms } = await timed(f, "https://www.tikwm.com/api/user/info?unique_id=tiktok", { headers: { "user-agent": DESKTOP_UA, accept: "application/json", referer: "https://www.tikwm.com/" } }, 15_000);
    const json = text.trimStart().startsWith("{");
    const quota = /Free Api Limit/i.test(text);
    const blocked = thirdPartyBlocked(res.status, text, res.headers) || res.status === 403 || res.status === 429;
    return { target: "tikwm.com", verdict: json && !quota && !blocked ? "ok" : blocked ? "blocked" : "warn", status: res.status, ms, note: quota ? "الحصة اليومية خلصت" : blocked ? "Cloudflare حاجب" : json ? "JSON" : "رد غير متوقع" };
  } catch (e) {
    return errLine("tikwm.com", e, t0);
  }
}

export async function probeCountik(f: F, secUid?: string): Promise<ProbeLine> {
  const t0 = Date.now();
  const url = secUid ? `https://countik.com/api/userinfo?sec_user_id=${encodeURIComponent(secUid)}` : "https://countik.com/";
  try {
    const { res, text, ms } = await timed(f, url, { headers: { "user-agent": DESKTOP_UA, accept: "application/json,text/html", referer: "https://countik.com/" } });
    const blocked = thirdPartyBlocked(res.status, text, res.headers) || res.status === 403 || res.status === 429;
    const okish = res.status >= 200 && res.status < 400 && !blocked;
    return { target: "countik.com", verdict: okish ? "ok" : blocked ? "blocked" : "warn", status: res.status, ms };
  } catch (e) {
    return errLine("countik.com", e, t0);
  }
}

/** Public Instagram profile JSON (anonymous, or with a session Cookie header). */
export async function probeInstagram(f: F, cookie?: string, csrf?: string): Promise<ProbeLine> {
  const t0 = Date.now();
  try {
    const { res, text, ms } = await timed(f, "https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram", {
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "*/*",
        "x-ig-app-id": "936619743392459",
        "x-requested-with": "XMLHttpRequest",
        referer: "https://www.instagram.com/instagram/",
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { "x-csrftoken": csrf } : {}),
      },
    });
    const json = text.trimStart().startsWith("{");
    const hasUser = json && /"username"\s*:\s*"instagram"/.test(text);
    const login = /accounts\/login|login_required|"require_login":true/.test(res.url + text.slice(0, 3000));
    return {
      target: "instagram.com",
      verdict: hasUser ? "ok" : res.status === 429 || login ? "blocked" : "warn",
      status: res.status,
      ms,
      note: hasUser ? "بيانات الحساب وصلت" : res.status === 429 ? "حد طلبات 429 (IP محروق عند انستقرام)" : login ? "طلب تسجيل دخول" : json ? "JSON بدون بيانات" : "HTML",
    };
  } catch (e) {
    return errLine("instagram.com", e, t0);
  }
}

const ICON: Record<Verdict, string> = { ok: "✅", blocked: "⛔", error: "❌", warn: "⚠️" };
export function formatLines(title: string, lines: ProbeLine[]): string {
  return [title, ...lines.map((l) => `• ${l.target}: ${l.status ? `HTTP ${l.status} ` : ""}${ICON[l.verdict]}${l.note ? ` ${l.note}` : ""} (${(l.ms / 1000).toFixed(1)}s)`)].join("\n");
}
