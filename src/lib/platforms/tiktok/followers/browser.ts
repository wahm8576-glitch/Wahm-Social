import "server-only";
/**
 * Fetch TikTok followers/following via Chromium + session cookies.
 * TikTok's own page JS signs fetch(); we never generate X-Bogus.
 */
import type { Connection } from "../../types";
import { cookieValue, cookiesForBrowser, hasTikTokSession, CHROME_UA } from "../session";
import { proxyForBrowser } from "../../../server/http";

export type BrowserListResult = {
  items: Connection[];
  region?: string;
  note: string;
  status?: number;
  bodyLen?: number;
};

let lastBrowserTry: { at: string; note: string; status?: number; bodyLen?: number; n?: number; proxy?: boolean; htmlLen?: number } | null = null;
export const lastBrowserListTry = () => lastBrowserTry;

/** Session traffic in Chromium goes through SCRAPER_PROXY (active entry) when set. */
async function launchBrowser(proxyServer?: string) {
  const proxyArgs = proxyServer ? [`--proxy-server=${proxyServer}`] : [];
  const stealthMod = await import("puppeteer-extra-plugin-stealth");
  const puppeteerExtra = await import("puppeteer-extra");
  const puppeteer = puppeteerExtra.default;
  puppeteer.use(stealthMod.default());

  try {
    const fs = await import("fs");
    for (const bin of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", process.env.CHROME_PATH].filter(Boolean) as string[]) {
      if (fs.existsSync(bin)) {
        return puppeteer.launch({
          executablePath: bin,
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled", "--lang=en-US", ...proxyArgs],
        });
      }
    }
  } catch {
    /* fall through */
  }
  const chromium = await import("@sparticuz/chromium");
  return puppeteer.launch({
    args: [...chromium.default.args, "--lang=en-US", "--disable-blink-features=AutomationControlled", "--no-sandbox", ...proxyArgs],
    defaultViewport: { width: 1365, height: 900 },
    executablePath: await chromium.default.executablePath(),
    headless: true,
  });
}

function parseList(j: { userList?: { user?: Record<string, unknown> }[] }): Connection[] {
  return (j.userList ?? [])
    .map((x) => x.user ?? (x as unknown as Record<string, unknown>))
    .filter((u) => u?.uniqueId || u?.unique_id)
    .map((u) => ({
      username: String(u.uniqueId || u.unique_id),
      displayName: String(u.nickname || u.uniqueId || u.unique_id),
      avatarUrl: String(u.avatarThumb || u.avatarMedium || ""),
      verified: Boolean(u.verified),
    }));
}

/**
 * Chromium is heavy on the free 512 MB instance: while it runs, every other page waits.
 * Only one browser at a time, and after a failed run wait a few minutes before launching again.
 */
const bg = globalThis as unknown as { __frostlyBrowserBusy?: boolean; __frostlyBrowserFailAt?: number };
const BROWSER_RETRY_AFTER_FAIL_MS = 5 * 60_000;

export async function browserList(
  username: string,
  kind: "followers" | "following",
  secUidHint = "",
): Promise<BrowserListResult> {
  if (bg.__frostlyBrowserBusy) return { items: [], note: "browser_busy" };
  if (bg.__frostlyBrowserFailAt && Date.now() - bg.__frostlyBrowserFailAt < BROWSER_RETRY_AFTER_FAIL_MS) {
    return { items: [], note: "browser_cooldown" };
  }
  bg.__frostlyBrowserBusy = true;
  try {
    const r = await browserListInner(username, kind, secUidHint);
    bg.__frostlyBrowserFailAt = r.items.length ? undefined : Date.now();
    return r;
  } catch (e) {
    bg.__frostlyBrowserFailAt = Date.now();
    throw e;
  } finally {
    bg.__frostlyBrowserBusy = false;
  }
}

async function browserListInner(
  username: string,
  kind: "followers" | "following",
  secUidHint = "",
): Promise<BrowserListResult> {
  if (!hasTikTokSession()) {
    lastBrowserTry = { at: new Date().toISOString(), note: "not_configured" };
    return { items: [], note: "not_configured" };
  }
  const cookies = cookiesForBrowser();
  if (!cookies.length) {
    lastBrowserTry = { at: new Date().toISOString(), note: "not_configured" };
    return { items: [], note: "not_configured" };
  }

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  let pageInfo: { proxy: boolean; htmlLen?: number } = { proxy: false };
  try {
    const proxy = proxyForBrowser();
    browser = await launchBrowser(proxy?.server);
    const page = await browser.newPage();
    if (proxy?.username) await page.authenticate({ username: proxy.username, password: proxy.password ?? "" });
    console.warn(`[tiktok-followers] browser proxy=${proxy ? "yes" : "no"}`);
    // Save proxy bandwidth: skip images, video, fonts (the signed list call is XHR).
    await page.setRequestInterception(true);
    page.on("request", (req: { resourceType: () => string; abort: () => Promise<void>; continue: () => Promise<void>; isInterceptResolutionHandled?: () => boolean }) => {
      if (req.isInterceptResolutionHandled?.()) return;
      const t = req.resourceType();
      if (t === "image" || t === "media" || t === "font") req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
    await page.setUserAgent(CHROME_UA);
    await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
    await page.setCookie(...cookies);

    let region: string | undefined;
    const captureBox: { current: { status: number; bodyLen: number; items: Connection[] } | null } = { current: null };

    page.on("response", async (res: { url: () => string; text: () => Promise<string>; status: () => number }) => {
      try {
        const url = res.url();
        if (!url.includes("/api/user/list")) return;
        const text = await res.text();
        if (!text.trimStart().startsWith("{")) return;
        const j = JSON.parse(text);
        const items = parseList(j).filter((c) => c.username.toLowerCase() !== username.toLowerCase());
        const prev = captureBox.current;
        if (items.length && text.length > 500 && (!prev || text.length > (prev.bodyLen || 0))) {
          captureBox.current = { status: res.status(), bodyLen: text.length, items };
        }
      } catch {
        /* ignore */
      }
    });

    await page.goto(`https://www.tiktok.com/@${encodeURIComponent(username)}?lang=en`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 2000));
    try {
      await page.waitForFunction(
        () =>
          Boolean((window as unknown as { byted_acrawler?: unknown }).byted_acrawler) ||
          Boolean(document.querySelector('[data-e2e="followers-count"]')) ||
          Boolean(document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__")),
        { timeout: 15000 },
      );
    } catch {
      /* continue anyway */
    }
    await new Promise((r) => setTimeout(r, 1500));

    const meta = await page.evaluate(() => {
      const s = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      const htmlLen = document.documentElement?.outerHTML?.length || 0;
      if (!s?.textContent) {
        return {
          secUid: "",
          region: undefined as string | undefined,
          challenge: htmlLen < 8000 || /captcha|challenge|verify|slardar/i.test(document.body?.innerText || document.title || ""),
          htmlLen,
        };
      }
      try {
        const u = JSON.parse(s.textContent).__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo?.user;
        const r = u?.region;
        return {
          secUid: String(u?.secUid || ""),
          region: typeof r === "string" && /^[A-Za-z]{2}$/.test(r) ? r.toUpperCase() : undefined,
          challenge: false,
          htmlLen,
        };
      } catch {
        return { secUid: "", region: undefined, challenge: true, htmlLen };
      }
    });
    region = meta.region;
    const secUid = meta.secUid || secUidHint;
    pageInfo = { proxy: Boolean(proxy), htmlLen: meta.htmlLen };
    console.warn(`[tiktok-followers] browser page html=${meta.htmlLen} secUid=${secUid ? "yes" : "no"} challenge=${meta.challenge}`);

    // Tiny/challenge HTML cannot sign requests — bail before long click waits.
    if (meta.challenge && meta.htmlLen < 8000) {
      lastBrowserTry = { ...pageInfo, at: new Date().toISOString(), note: "browser_challenge" };
      return { items: [], region, note: "browser_challenge" };
    }
    if (!secUid) {
      lastBrowserTry = { ...pageInfo, at: new Date().toISOString(), note: meta.challenge ? "browser_challenge" : "browser_no_secuid" };
      return { items: [], region, note: meta.challenge ? "browser_challenge" : "browser_no_secuid" };
    }

    const scene = kind === "followers" ? "67" : "21";
    const msToken = cookieValue("msToken");
    const verifyFp = cookieValue("s_v_web_id");
    const deviceId = cookieValue("ttwid") || verifyFp;
    const storeRegion = (cookieValue("store-country-code") || "US").toUpperCase();

    // 1) Click the Followers/Following control first — TikTok UI issues a fully signed list request.
    {
      const sel = kind === "followers" ? '[data-e2e="followers-count"]' : '[data-e2e="following-count"]';
      // The count control only exists after TikTok's app hydrates (slow on a small CPU) — wait for it.
      await page.waitForSelector(sel, { timeout: 20000 }).catch(() => undefined);
      const clicked = await page.evaluate((s: string, kind: "followers" | "following") => {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el) { el.click(); return "e2e"; }
        const label = kind === "followers" ? /followers/i : /following/i;
        for (const n of document.querySelectorAll("strong, span, a, div, button")) {
          const t = n.textContent || "";
          if (label.test(t) && /\d/.test(t)) { (n as HTMLElement).click(); return "text"; }
        }
        return null;
      }, sel, kind);
      console.warn(`[tiktok-followers] browser click=${clicked}`);
      for (let i = 0; i < 40 && !captureBox.current; i++) await new Promise((r) => setTimeout(r, 500));
    }

    // 2) If UI click didn't yield a list, call fetch — prefer TikTok's own byted_acrawler.sign when present.
    if (!captureBox.current) {
      const inPage = await page.evaluate(
        async ({ secUid, scene, msToken, verifyFp, deviceId, region }: { secUid: string; scene: string; msToken: string; verifyFp: string; deviceId: string; region: string }) => {
          const qs = new URLSearchParams({
            aid: "1988",
            app_language: "en",
            app_name: "tiktok_web",
            browser_language: "en-US",
            browser_name: "Mozilla",
            browser_online: "true",
            browser_platform: "Win32",
            channel: "tiktok_web",
            cookie_enabled: "true",
            count: "30",
            device_platform: "web_pc",
            from_page: "user",
            maxCursor: "0",
            minCursor: "0",
            os: "windows",
            region,
            scene,
            secUid,
            webcast_language: "en",
          });
          if (msToken) qs.set("msToken", msToken);
          if (deviceId) qs.set("device_id", deviceId);
          if (verifyFp) qs.set("verifyFp", verifyFp);
          let path = `/api/user/list/?${qs.toString()}`;
          try {
            const ac = (window as unknown as { byted_acrawler?: { sign?: (o: { url: string }) => Record<string, string> } }).byted_acrawler;
            if (ac?.sign) {
              const signed = ac.sign({ url: path });
              for (const [k, v] of Object.entries(signed || {})) {
                if (v != null) qs.set(k, String(v));
              }
              path = `/api/user/list/?${qs.toString()}`;
            }
          } catch { /* use unsigned path; TikTok fetch hooks may still sign */ }
          // TikTok's security SDK hooks XMLHttpRequest and signs /api/ calls (X-Bogus / X-Gnarly / msToken)
          // made through it — so try XHR first, then plain fetch.
          const viaXhr = await new Promise<{ status: number; text: string; url: string }>((resolve) => {
            try {
              const x = new XMLHttpRequest();
              x.open("GET", path, true);
              x.withCredentials = true;
              x.setRequestHeader("accept", "application/json, text/plain, */*");
              x.timeout = 15000;
              x.onload = () => resolve({ status: x.status, text: x.responseText || "", url: x.responseURL || "" });
              x.onerror = x.ontimeout = () => resolve({ status: 0, text: "", url: "" });
              x.send();
            } catch {
              resolve({ status: 0, text: "", url: "" });
            }
          });
          if (viaXhr.text.trimStart().startsWith("{") && viaXhr.text.length > 500) {
            return { status: viaXhr.status, text: viaXhr.text, signed: /X-Bogus|X-Gnarly/.test(viaXhr.url) || path.includes("X-Bogus"), via: "xhr" };
          }
          try {
            const res = await fetch(path, { credentials: "include", headers: { accept: "application/json" } });
            const text = await res.text();
            return { status: res.status, text, signed: path.includes("X-Bogus") || path.includes("X-Gnarly"), via: `fetch(xhr=${viaXhr.status}/${viaXhr.text.length})` };
          } catch (e) {
            return { status: 0, text: "", err: String(e).slice(0, 80), signed: false, via: "error" };
          }
        },
        { secUid, scene, msToken, verifyFp, deviceId, region: storeRegion },
      );
      console.warn(`[tiktok-followers] browser inpage status=${inPage.status} body=${(inPage.text || "").length} signed=${inPage.signed} via=${(inPage as { via?: string }).via ?? "?"}`);
      if (inPage.text?.trimStart().startsWith("{")) {
        try {
          const j = JSON.parse(inPage.text);
          const items = parseList(j).filter((c) => c.username.toLowerCase() !== username.toLowerCase());
          if (items.length && inPage.text.length > 500) {
            captureBox.current = { status: inPage.status, bodyLen: inPage.text.length, items };
          }
        } catch { /* ignore */ }
      }
    }

    const got = captureBox.current;
    if (got?.items.length) {
      lastBrowserTry = { ...pageInfo, at: new Date().toISOString(), note: "ok", status: got.status, bodyLen: got.bodyLen, n: got.items.length };
      console.warn(`[tiktok-followers] browser ok status=${got.status} body=${got.bodyLen} n=${got.items.length}`);
      return { items: got.items, region, note: "ok", status: got.status, bodyLen: got.bodyLen };
    }
    lastBrowserTry = {
      ...pageInfo,
      at: new Date().toISOString(),
      note: meta.challenge ? "browser_challenge" : "browser_empty",
      status: got?.status,
      bodyLen: got?.bodyLen,
    };
    return { items: [], region, note: meta.challenge ? "browser_challenge" : "browser_empty", status: got?.status, bodyLen: got?.bodyLen };
  } catch (e) {
    const note = (e as Error).message?.slice(0, 60) || "browser_error";
    lastBrowserTry = { ...pageInfo, at: new Date().toISOString(), note };
    console.warn(`[tiktok-followers] browser fail: ${note}`);
    return { items: [], note };
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
