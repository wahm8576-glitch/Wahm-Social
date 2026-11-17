import "server-only";
/**
 * Free TikTok fallbacks that do not depend on tikwm:
 *  - stories: TikTok's own /api/story/item_list (unsigned GET, verified live)
 *  - video / no-watermark / mp3: savetik.co and tikdownloader.io (same API shape, separate sites)
 * All requests use the proxy → direct → Worker chain.
 */
import { DESKTOP_UA, httpGet } from "../../server/http";
import type { Story } from "../types";
import { parseSaveTik, storiesFromTikTokApi, type FreeVideo } from "./free-parse";
import { recordFail, recordOk } from "../../sources/health";
import { execFile } from "node:child_process";

/**
 * Some free downloaders sit behind a Cloudflare check that rejects Node's TLS client but accepts curl.
 * When the system has curl (Render's native runtime does), use it for that one POST.
 */
function curlPost(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  const args = ["-s", "-m", String(Math.ceil(timeoutMs / 1000)), "-X", "POST", url, "--data-raw", body];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  return new Promise((resolve, reject) =>
    execFile("curl", args, { maxBuffer: 4 << 20, timeout: timeoutMs + 1000 }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );
}
const challenged = (status: number, text: string) => status === 403 || /Just a moment|cf-chl/i.test(text.slice(0, 2000));

export async function tiktokApiStories(authorId: string, username: string): Promise<Story[] | null> {
  const t = Date.now();
  try {
    const res = await httpGet(
      `https://www.tiktok.com/api/story/item_list/?aid=1988&authorId=${encodeURIComponent(authorId)}&count=20&cursor=0&loadBackward=false`,
      { timeoutMs: 8000, headers: { accept: "application/json", referer: `https://www.tiktok.com/@${username}` }, chain: true },
    );
    const json = JSON.parse(res.text);
    if (String(json?.statusCode ?? json?.status_code ?? "0") !== "0") throw new Error(`status ${json?.statusCode}`);
    const items = storiesFromTikTokApi(json, username);
    recordOk("tt-stories", Date.now() - t);
    return items;
  } catch (e) {
    recordFail("tt-stories", Date.now() - t, String((e as Error)?.message ?? e));
    return null;
  }
}

const SAVERS = [
  { id: "savetik", url: "https://savetik.co/api/ajaxSearch", ref: "https://savetik.co/en" },
  { id: "tikdownloader", url: "https://tikdownloader.io/api/ajaxSearch", ref: "https://tikdownloader.io/en" },
];

export async function freeVideo(videoUrl: string): Promise<(FreeVideo & { source: string }) | null> {
  for (const s of SAVERS) {
    const t = Date.now();
    try {
      const body = `q=${encodeURIComponent(videoUrl)}&lang=en`;
      const headers = {
        "user-agent": DESKTOP_UA,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        accept: "*/*",
        origin: new URL(s.ref).origin,
        referer: s.ref,
      };
      const res = await httpGet(s.url, { method: "POST", body, timeoutMs: 8000, chain: true, headers });
      let text = res.text;
      if (challenged(res.status, text)) text = await curlPost(s.url, body, headers, 10000);
      const json = JSON.parse(text);
      const v = json?.status === "ok" && typeof json.data === "string" ? parseSaveTik(json.data) : null;
      if (v) {
        recordOk(s.id, Date.now() - t);
        return { ...v, source: s.id };
      }
      recordFail(s.id, Date.now() - t, String(json?.msg ?? "empty").replace(/<[^>]+>/g, "").slice(0, 100));
    } catch (e) {
      recordFail(s.id, Date.now() - t, String((e as Error)?.message ?? e));
    }
  }
  return null;
}
