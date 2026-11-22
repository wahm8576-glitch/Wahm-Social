"use client";

import { useEffect, useState } from "react";
import type { Platform, PostCommentsResult } from "@/lib/platforms/types";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/format";
import { compact } from "@/lib/format";

export function PostCommentsPanel({
  platform,
  postRef,
  username,
  labels,
  locale,
}: {
  platform: Platform;
  postRef: string;
  username?: string;
  labels: Dict["post"];
  locale: Locale;
}) {
  const [result, setResult] = useState<PostCommentsResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    const query = new URLSearchParams({ ref: postRef });
    if (username) query.set("u", username);
    fetch(`/api/post/${platform}/comments?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok || !payload?.data) throw new Error("comments unavailable");
        return payload.data as PostCommentsResult;
      })
      .then(setResult)
      .catch(() => {
        if (!controller.signal.aborted) setResult({ status: "unavailable", comments: [], rankedByLikes: false, sampleSize: 0 });
      });
    return () => controller.abort();
  }, [platform, postRef, username]);

  return (
    <section className="card mt-5 p-5" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-ink">{labels.topComments}</h2>
        {result?.status === "available" && (
          <span className="text-xs text-ink-3">
            {result.rankedByLikes ? labels.commentsRankedNote : labels.commentsNotRankedNote}
          </span>
        )}
      </div>
      {!result ? (
        <p className="text-sm text-ink-3">{labels.commentsLoading}</p>
      ) : result.status === "session_required" ? (
        <p className="text-sm text-ink-3">{labels.commentsSessionRequired}</p>
      ) : result.status === "unavailable" ? (
        <p className="text-sm text-ink-3">{labels.commentsUnavailable}</p>
      ) : result.status === "empty" ? (
        <p className="text-sm text-ink-3">{labels.commentsEmpty}</p>
      ) : (
        <ol className="divide-y divide-line">
          {result.comments.map((comment, index) => (
            <li key={comment.id} className="py-3 first:pt-1 last:pb-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 text-sm font-semibold text-ink">
                  <span className="me-2 text-accent-500">{index + 1}.</span>
                  {comment.username && (!comment.authorName || comment.username.toLowerCase() === comment.authorName.toLowerCase())
                    ? `@${comment.username}`
                    : comment.authorName || labels.commentAuthorUnknown}
                  {comment.username && comment.authorName && comment.username.toLowerCase() !== comment.authorName.toLowerCase() && (
                    <span className="ms-2 text-xs font-normal text-ink-3" dir="ltr">@{comment.username}</span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-ink-3">
                  {comment.likes === undefined ? labels.commentLikesUnavailable : `♥ ${compact(comment.likes, locale)} ${labels.commentLikes}`}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink-2">{comment.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
