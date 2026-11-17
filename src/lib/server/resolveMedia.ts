import "server-only";
/**
 * Resolve the concrete CDN URL (+cookies) for a post's media item.
 * TikTok media URLs are bound to the page-request cookies, so results are
 * cached briefly to serve HTTP range requests without re-scraping.
 */
import { getPost } from "../platforms";
import { fetchVideoPage } from "../platforms/tiktok/adapter";
import { tikwmVideo } from "../platforms/tiktok/tikwm";
import { freeVideo } from "../platforms/tiktok/free";
import { parseTikTokRef } from "../platforms/tiktok/parser";
import { PlatformError, type Platform } from "../platforms/types";
import { cache } from "./cache";

export interface ResolvedMedia {
  url: string;
  cookie?: string;
  ext: string;
  filename: string;
}

export async function resolveMedia(platform: Platform, ref: string, opts: { author?: string; index?: number; kind?: string } = {}): Promise<ResolvedMedia> {
  const index = opts.index ?? 0;
  const key = `media:${platform}:${ref}:${index}:${opts.kind ?? ""}`;
  const hit = cache.get<ResolvedMedia>(key);
  if (hit) return hit;

  let out: ResolvedMedia;
  if (platform === "tiktok") {
    const parsed = parseTikTokRef(ref);
    const author = parsed.username ?? opts.author ?? "i";
    const id = parsed.id ?? ref;
    try {
      const { post, cookie } = await fetchVideoPage(author, id);
      if (opts.kind === "audio") {
        if (!post.music?.url) throw new PlatformError("not_found", "No audio for this post", 404);
        out = { url: post.music.url, cookie, ext: "mp3", filename: `frostly_tiktok_${post.author}_${post.id}_audio.mp3` };
      } else {
        const m = post.media[index] ?? post.media[0];
        if (!m) throw new PlatformError("not_found", "No downloadable media", 404);
        const ext = m.type === "video" ? "mp4" : "jpg";
        out = { url: m.url, cookie, ext, filename: `frostly_tiktok_${post.author}_${post.id}${index ? "_" + index : ""}.${ext}` };
      }
    } catch (e) {
      const url = `https://www.tiktok.com/@${author}/video/${id}`;
      // Free no-watermark downloaders first (savetik / tikdownloader), tikwm last.
      const free = await freeVideo(url);
      if (free && (opts.kind !== "audio" || free.music)) {
        const file = `frostly_tiktok_${author}_${id}`;
        out = opts.kind === "audio" ? { url: free.music!, ext: "mp3", filename: `${file}_audio.mp3` } : { url: (free.play || free.hd)!, ext: "mp4", filename: `${file}.mp4` };
        cache.set(key, out, 5 * 60_000);
        return out;
      }
      const fb = await tikwmVideo(url);
      if (!fb.ok) throw e;
      if (opts.kind === "audio") {
        if (!fb.data.music) throw new PlatformError("not_found", "No audio for this post", 404);
        out = { url: fb.data.music, ext: "mp3", filename: `frostly_tiktok_${fb.data.author ?? author}_${fb.data.id ?? id}_audio.mp3` };
      } else {
        const ext = "mp4";
        out = { url: fb.data.play, ext, filename: `frostly_tiktok_${fb.data.author ?? author}_${fb.data.id ?? id}.${ext}` };
      }
    }
  } else {
    const { data: post } = await getPost("instagram", ref);
    const m = post.media[index] ?? post.media[0];
    if (!m) throw new PlatformError("not_found", "No downloadable media", 404);
    const ext = m.type === "video" ? "mp4" : "jpg";
    out = { url: m.url, ext, filename: `frostly_instagram_${post.author}_${post.shortcode ?? post.id}${index ? "_" + index : ""}.${ext}` };
  }
  cache.set(key, out, 5 * 60_000);
  return out;
}
