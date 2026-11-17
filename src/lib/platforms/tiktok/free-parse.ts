/** Pure parsers for free (non-tikwm) TikTok sources: TikTok's own story API and SaveTik-style downloaders. */
import type { Story } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** https://www.tiktok.com/api/story/item_list/?authorId=… (works unsigned) → stories. */
export function storiesFromTikTokApi(json: Any, username: string): Story[] {
  const list: Any[] = Array.isArray(json?.itemList) ? json.itemList : [];
  const out: Story[] = [];
  for (const it of list) {
    if (!it?.id || it.privateItem || it.secret) continue;
    const v = it.video ?? {};
    const images: Any[] = it.imagePost?.images ?? [];
    const img = images[0]?.imageURL?.urlList?.[0] as string | undefined;
    const play: string = v.playAddr || v.downloadAddr || v.PlayAddrStruct?.UrlList?.[0] || "";
    const isVideo = !!play && !img;
    const url = isVideo ? play : img || v.originCover || v.cover || "";
    if (!url) continue;
    const takenAt = Number(it.createTime) || undefined;
    out.push({
      platform: "tiktok",
      id: String(it.id),
      author: it.author?.uniqueId || username,
      type: isVideo ? "video" : "image",
      url,
      thumbnail: v.originCover || v.cover || url,
      takenAt,
      expiresAt: takenAt ? takenAt + 24 * 3600 : undefined,
    });
  }
  return out;
}

export interface FreeVideo {
  /** No-watermark MP4 (TikTok CDN when available). */
  play?: string;
  hd?: string;
  music?: string;
  title?: string;
}

function jwtUrl(link: string): { url: string; filename: string } | null {
  try {
    const token = new URL(link.replace(/&amp;/g, "&")).searchParams.get("token") ?? "";
    const part = token.split(".")[1];
    if (!part) return null;
    const p = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof p.url === "string" ? { url: p.url, filename: String(p.filename ?? "") } : null;
  } catch {
    return null;
  }
}

/** savetik.co / tikdownloader.io `api/ajaxSearch` HTML → direct CDN links decoded from the download tokens. */
export function parseSaveTik(html: string): FreeVideo | null {
  const out: FreeVideo = {};
  for (const m of html.matchAll(/href="(https:\/\/dl\.snapcdn\.app\/get\?token=[^"]+)"/g)) {
    const d = jwtUrl(m[1]);
    if (!d) continue;
    if (/\.mp3$/i.test(d.filename)) out.music ??= d.url;
    else if (/-hd\.mp4$/i.test(d.filename)) out.hd ??= d.url;
    else if (/\.mp4$/i.test(d.filename)) out.play ??= d.url;
  }
  const title = html.match(/<h3>([^<]*)<\/h3>/)?.[1];
  if (title) out.title = title.trim();
  return out.play || out.hd ? out : null;
}
