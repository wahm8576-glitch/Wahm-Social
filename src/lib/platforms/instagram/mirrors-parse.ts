/** Pure parsers for the extra Instagram sources (dumpor mirror, IG oEmbed). */
import type { Profile } from "../types";
import { parseCount } from "./preview/parse";

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function base(username: string): Profile {
  return {
    platform: "instagram",
    id: "",
    username,
    displayName: username,
    bio: "",
    avatarUrl: "",
    verified: false,
    isPrivate: false,
    followers: 0,
    following: 0,
    postsCount: 0,
    profileUrl: `https://www.instagram.com/${username}/`,
  };
}

export function parseDumpor(html: string, username: string): Profile | null {
  const h1 = html.match(/<h1[^>]*>\s*@([A-Za-z0-9._]+)\s*<\/h1>/);
  if (!h1 || h1[1].toLowerCase() !== username.toLowerCase()) return null;
  const stat = (label: string) => {
    const m = html.match(new RegExp(`<span>${label}</span>[\\s\\S]{0,600}?<dd[^>]*>\\s*([^<]+?)\\s*</dd>`));
    return m ? parseCount(m[1]) : undefined;
  };
  const followers = stat("Followers");
  if (followers === undefined) return null;
  const after = html.slice(h1.index ?? 0, (h1.index ?? 0) + 3000);
  const ps = [...after.matchAll(/<p class="[^"]*">([\s\S]*?)<\/p>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, " ")));
  const avatar = html.match(/<img src="(https:\/\/media\.dumpor\.io\/[^"]+)"[^>]*alt="[^"]*avatar"/)?.[1];
  return {
    ...base(h1[1]),
    displayName: ps[0] || h1[1],
    bio: ps[1] ?? "",
    avatarUrl: avatar ? decode(avatar) : "",
    verified: /<span>Verified<\/span>/.test(after),
    followers,
    following: stat("Following") ?? 0,
    postsCount: stat("Posts") ?? 0,
    preview: true,
  };
}

export interface IgOembed {
  displayName: string;
  avatarUrl: string;
}

export function parseIgOembed(text: string, username: string): IgOembed | null {
  try {
    const j = JSON.parse(text) as { author_name?: string; title?: string; thumbnail_url?: string };
    if (!j.author_name && !j.title) return null;
    if (j.author_name && j.author_name.toLowerCase() !== username.toLowerCase() && !j.title?.toLowerCase().includes(`@${username.toLowerCase()}`)) return null;
    const name = j.title?.match(/^(.*?)'s? \(@/)?.[1] ?? j.title?.match(/^(.*?) \(@/)?.[1];
    return { displayName: name ? decode(name).replace(/'$/, "") : (j.author_name ?? username), avatarUrl: j.thumbnail_url ?? "" };
  } catch {
    return null;
  }
}

/** Minimal profile from the oEmbed (no counts) — only when nothing better exists. */
export function profileFromOembed(o: IgOembed, username: string): Profile {
  return { ...base(username), displayName: o.displayName, avatarUrl: o.avatarUrl, preview: true };
}
