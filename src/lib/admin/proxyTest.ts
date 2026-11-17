import "server-only";
import { probeInstagram } from "../pools/probe";
import { DESKTOP_UA, looksLikeBotWall, proxiedFetch, proxyList } from "../server/http";
import { thirdPartyBlocked } from "../platforms/tiktok/fallback-http";
import { readRelayUrl, rewriteViaRelay, validateRelayUrl } from "../server/relay";
import { validateProxy } from "../pools/validate";

export { validateRelayUrl } from "../server/relay";

/** Accepts one proxy URL or several separated by commas / new lines (failover order). */
export function validateProxyUrl(v: string): string | null {
  const list = proxyList(v);
  if (!list.length) return "رابط البروكسي غير صالح";
  for (const one of list) {
    const bad = validateOneProxy(one);
    if (bad) return list.length > 1 ? `${bad} (${one.replace(/\/\/[^@]*@/, "//***@")})` : bad;
  }
  return null;
}

const validateOneProxy = validateProxy;

const TARGETS: [string, string][] = [
  ["tiktok.com", "https://www.tiktok.com/@tiktok"],
  ["tikwm.com", "https://www.tikwm.com/api/user/info?unique_id=tiktok"],
  ["countik.com", "https://countik.com/"],
];

/** Fetch a few targets through the proxy (or directly when none is set) and describe each result. */
export async function runProxyTest(candidate?: string): Promise<string> {
  const list = proxyList(candidate ?? process.env.SCRAPER_PROXY ?? "");
  if (list.length <= 1) return runOneProxyTest(list[0] ?? "", Boolean(candidate));
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    out.push(`— بروكسي #${i + 1} —`);
    out.push(await runOneProxyTest(list[i], Boolean(candidate)));
  }
  return out.join("\n");
}

async function runOneProxyTest(using: string, typed: boolean): Promise<string> {
  const f = (using ? await proxiedFetch(using) : null) ?? fetch;
  const lines = [using ? `الاختبار عبر البروكسي${typed ? " (الرابط اللي كتبته)" : " (المحفوظ)"}:` : "ما فيه بروكسي — الاختبار مباشر من السيرفر:"];
  for (const [label, url] of TARGETS) {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await f(url, { headers: { "user-agent": DESKTOP_UA, accept: "text/html,application/json;q=0.9,*/*;q=0.8" }, signal: ctrl.signal, cache: "no-store" } as RequestInit);
      const text = await res.text();
      // tiktok.com is an HTML page (only a challenge/WAF page counts as blocked); tikwm/countik must return JSON.
      const blocked =
        label === "tiktok.com"
          ? looksLikeBotWall(text) || /_wafchallengeid|tiktok-verify-page/i.test(text.slice(0, 20000)) || res.status === 403
          : label === "tikwm.com"
            ? thirdPartyBlocked(res.status, text, res.headers) || res.status === 403
            : res.status === 403 || looksLikeBotWall(text);
      const verdict = res.status >= 200 && res.status < 400 && !blocked ? "✅ يشتغل" : blocked ? "⛔ محجوب (Cloudflare/تحقق)" : "⚠️";
      lines.push(`• ${label}: HTTP ${res.status} ${verdict} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      lines.push(`• ${label}: ❌ فشل الاتصال (${String((e as Error).name === "AbortError" ? "timeout" : (e as Error).message).slice(0, 80)})`);
    } finally {
      clearTimeout(timer);
    }
  }
  // Instagram too: every Instagram request goes through these proxies.
  const ig = await probeInstagram(f);
  const icon = ig.verdict === "ok" ? "✅ يشتغل" : ig.verdict === "blocked" ? "⛔ مرفوض" : ig.verdict === "error" ? "❌" : "⚠️";
  lines.push(`• instagram.com: ${ig.status ? `HTTP ${ig.status} ` : ""}${icon}${ig.note ? ` — ${ig.note}` : ""}${ig.ms ? ` (${(ig.ms / 1000).toFixed(1)}s)` : ""}`);
  return lines.join("\n");
}

const RELAY_TIKTOK = "https://www.tiktok.com/@khaby.lame";

/** Fetch a TikTok profile and countik through the Worker relay. */
export async function runRelayTest(candidate?: string): Promise<string> {
  const base = readRelayUrl(candidate);
  if (!base) return "ما فيه RELAY_URL — اكتب رابط الـ Worker أولاً (مثال: https://name.workers.dev).";
  const bad = validateRelayUrl(base);
  if (bad) return bad;
  const lines = [candidate ? "الاختبار عبر الـ Worker (الرابط اللي كتبته):" : "الاختبار عبر الـ Worker (المحفوظ):"];
  const ping = async (label: string, target: string, check: (status: number, text: string) => string) => {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(rewriteViaRelay(target, base), {
        headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
        signal: ctrl.signal,
        cache: "no-store",
      });
      const text = await res.text();
      const verdict = check(res.status, text);
      lines.push(`• ${label}: HTTP ${res.status} ${verdict} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return { status: res.status, text };
    } catch (e) {
      lines.push(`• ${label}: ❌ فشل الاتصال (${String((e as Error).name === "AbortError" ? "timeout" : (e as Error).message).slice(0, 80)})`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const tiktok = await ping("tiktok.com profile", RELAY_TIKTOK, (status, text) => {
    const hasData = /__UNIVERSAL_DATA_FOR_REHYDRATION__/.test(text);
    const blocked = looksLikeBotWall(text) || /_wafchallengeid|tiktok-verify-page/i.test(text.slice(0, 20000));
    if (status >= 200 && status < 400 && hasData && !blocked) return "✅ يشتغل (بيانات الحساب وصلت)";
    if (blocked) return "⛔ محجوب (صفحة تحقق)";
    return "⚠️ رد بدون بيانات الحساب";
  });

  let countikTarget = "https://countik.com/api/userinfo?sec_user_id=test";
  if (tiktok?.text) {
    const m = tiktok.text.match(/"secUid":"([^"]+)"/);
    if (m) countikTarget = `https://countik.com/api/userinfo?sec_user_id=${encodeURIComponent(m[1])}`;
  }
  await ping("countik.com", countikTarget, (status, text) => {
    const json = text.trimStart().startsWith("{") || text.trimStart().startsWith("[");
    const blocked = thirdPartyBlocked(status, text) || status === 403;
    if (status >= 200 && status < 400 && json && !blocked) return "✅ يشتغل (JSON)";
    if (blocked) return "⛔ محجوب (Cloudflare/تحقق)";
    return "⚠️";
  });
  return lines.join("\n");
}
