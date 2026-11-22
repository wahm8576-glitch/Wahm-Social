import type { PostComment } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function asCount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Parse the public TikTok web comment-list response; null means an unknown response shape. */
export function parseTikTokComments(payload: Any): PostComment[] | null {
  const rows = payload?.comments ?? payload?.data?.comments;
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row: Any, index: number) => {
    const text = typeof row?.text === "string" ? row.text.trim().slice(0, 3000) : "";
    if (!text) return [];
    const user = row?.user ?? row?.user_info ?? {};
    const username = user?.unique_id ?? user?.uniqueId ?? user?.username;
    const authorName = user?.nickname ?? user?.display_name ?? user?.displayName ?? username;
    const id = row?.cid ?? row?.comment_id ?? row?.id ?? `${index}:${text.slice(0, 32)}`;
    return [{
      id: String(id),
      text,
      ...(typeof authorName === "string" && authorName ? { authorName: authorName.slice(0, 120) } : {}),
      ...(typeof username === "string" && username ? { username: username.replace(/^@/, "").slice(0, 80) } : {}),
      ...(asCount(row?.digg_count ?? row?.like_count ?? row?.likes_count) !== undefined
        ? { likes: asCount(row?.digg_count ?? row?.like_count ?? row?.likes_count) }
        : {}),
    }];
  });
}
