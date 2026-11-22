import type { PostComment } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function asCount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Parse Instagram's signed mobile comments response or a wrapped comments array. */
export function parseInstagramComments(payload: Any): PostComment[] | null {
  const rows = payload?.comments ?? payload?.data?.comments;
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row: Any, index: number) => {
    const text = typeof row?.text === "string" ? row.text.trim().slice(0, 3000) : "";
    if (!text) return [];
    const user = row?.user ?? row?.owner ?? {};
    const username = user?.username ?? row?.username;
    const authorName = user?.full_name ?? user?.fullName ?? username;
    const likes = asCount(row?.comment_like_count ?? row?.like_count ?? row?.likes_count);
    const id = row?.pk ?? row?.id ?? `${index}:${text.slice(0, 32)}`;
    return [{
      id: String(id),
      text,
      ...(typeof authorName === "string" && authorName ? { authorName: authorName.slice(0, 120) } : {}),
      ...(typeof username === "string" && username ? { username: username.replace(/^@/, "").slice(0, 80) } : {}),
      ...(likes !== undefined ? { likes } : {}),
    }];
  });
}
