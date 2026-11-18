import "server-only";
/**
 * Followers / following of a PUBLIC Instagram account, read with the server's own
 * signed-in session — the same list any logged-in visitor sees on instagram.com.
 * Private accounts never reach this function (the privacy gate runs first).
 */
import type { Connection } from "../../types";
import { PlatformError } from "../../types";
import { igJson } from "./api";
import { hasSession, type IgClient } from "./cookies";
import { recordIg } from "./diagnostics";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function igFriendships(userId: string, username: string, kind: "followers" | "following", count = 50): Promise<Connection[]> {
  if (!hasSession() || !/^\d+$/.test(userId)) throw new PlatformError("blocked", "Instagram session not available", 503);
  const qs = kind === "followers" ? `count=${count}&search_surface=follow_list_page` : `count=${count}`;
  const tries: [string, IgClient][] = [
    [`https://i.instagram.com/api/v1/friendships/${userId}/${kind}/?count=${count}`, "app-session"],
    [`https://www.instagram.com/api/v1/friendships/${userId}/${kind}/?${qs}`, "web-session"],
  ];
  const attempts = [];
  for (const [url, client] of tries) {
    const r = await igJson(url, client, `https://www.instagram.com/${username}/${kind}/`);
    attempts.push(r.attempt);
    if (r.ok && Array.isArray(r.json?.users) && r.json.users.length) {
      const users: any[] = r.json.users;
      console.info(`[instagram] @${username} ${kind} path=${client}:friendships result=ok n=${users.length}`);
      return users
        .filter((u) => u?.username)
        .map((u) => ({ username: u.username, displayName: u.full_name || u.username, avatarUrl: u.profile_pic_url || "", verified: !!u.is_verified }));
    }
  }
  recordIg(username, attempts, `${kind}_blocked`);
  throw new PlatformError("blocked", "Instagram refused the list request", 503);
}
