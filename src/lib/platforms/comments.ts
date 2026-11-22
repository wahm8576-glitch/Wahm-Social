import type { PostComment, PostCommentsResult } from "./types";

/** Rank only the comments we actually received; unavailable likes are never guessed. */
export function topComments(comments: PostComment[], limit = 5): PostCommentsResult {
  const clean = comments.filter((comment) => comment.text.trim().length > 0);
  const hasSomeLikes = clean.some((comment) => comment.likes !== undefined);
  const ranked = hasSomeLikes
    ? clean.map((comment, index) => ({ comment, index })).sort((a, b) =>
        (b.comment.likes ?? -1) - (a.comment.likes ?? -1) || a.index - b.index,
      ).map(({ comment }) => comment)
    : clean;
  return {
    status: ranked.length ? "available" : "empty",
    comments: ranked.slice(0, limit),
    rankedByLikes: ranked.length > 0 && ranked.every((comment) => comment.likes !== undefined),
    sampleSize: clean.length,
  };
}

export function unavailableComments(status: "unavailable" | "session_required" = "unavailable"): PostCommentsResult {
  return { status, comments: [], rankedByLikes: false, sampleSize: 0 };
}
