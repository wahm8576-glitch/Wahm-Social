import "server-only";
/**
 * Extra public Instagram sources (no login):
 *  - dumpor.io/v/<user>  — public mirror page (name, bio, verified, avatar, rounded counts)
 *  - IG oEmbed           — /api/v1/oembed/?url=<profile> (display name + avatar; proves the account exists)
 */
import { httpGet } from "../../server/http";
import type { Profile } from "../types";
import { parseDumpor, parseIgOembed, type IgOembed } from "./mirrors-parse";
export { profileFromOembed } from "./mirrors-parse";

export async function dumporProfile(username: string): Promise<Profile | null> {
  const res = await httpGet(`https://dumpor.io/v/${encodeURIComponent(username)}`, { timeoutMs: 8000 });
  if (res.status !== 200) throw new Error(`dumpor ${res.status} via ${res.via ?? "?"}`);
  return parseDumpor(res.text, username);
}

/** true/false when the oEmbed answered clearly; undefined when it could not be reached. */
export async function igOembed(username: string): Promise<IgOembed | false | undefined> {
  try {
    const url = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(`https://www.instagram.com/${username}/`)}`;
    const res = await httpGet(url, { timeoutMs: 6000, headers: { accept: "application/json" } });
    if (res.status === 404) return false;
    if (res.status !== 200) return undefined;
    return parseIgOembed(res.text, username) ?? undefined;
  } catch {
    return undefined;
  }
}

