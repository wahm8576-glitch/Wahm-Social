import { test } from "node:test";
import assert from "node:assert/strict";
import { topComments } from "../src/lib/platforms/comments";
import { parseTikTokComments } from "../src/lib/platforms/tiktok/comments";
import { parseInstagramComments } from "../src/lib/platforms/instagram/comments";

test("TikTok comment parser keeps text, account name, username and likes", () => {
  const parsed = parseTikTokComments({
    comments: [
      { cid: "c1", text: "Great video", digg_count: 23, user: { nickname: "Sara", unique_id: "sara1" } },
      { cid: "c2", text: "Nice", user: { unique_id: "other" } },
    ],
  });
  assert.deepEqual(parsed, [
    { id: "c1", text: "Great video", authorName: "Sara", username: "sara1", likes: 23 },
    { id: "c2", text: "Nice", authorName: "other", username: "other" },
  ]);
  assert.equal(parseTikTokComments({ status_code: 1 }), null);
});

test("Instagram parser reads comment likes only when the field is supplied", () => {
  const parsed = parseInstagramComments({ comments: [
    { pk: "ig1", text: "So good", comment_like_count: 8, user: { username: "creator_fan", full_name: "A. User" } },
    { pk: "ig2", text: "Love it", user: { username: "another_fan" } },
  ] });
  assert.deepEqual(parsed, [
    { id: "ig1", text: "So good", authorName: "A. User", username: "creator_fan", likes: 8 },
    { id: "ig2", text: "Love it", authorName: "another_fan", username: "another_fan" },
  ]);
});

test("topComments returns no more than five and orders known like counts descending", () => {
  const source = Array.from({ length: 8 }, (_, i) => ({ id: String(i), text: `Comment ${i}`, likes: i * 2 }));
  const result = topComments(source, 5);
  assert.equal(result.status, "available");
  assert.equal(result.sampleSize, 8);
  assert.equal(result.rankedByLikes, true);
  assert.deepEqual(result.comments.map((item) => item.likes), [14, 12, 10, 8, 6]);
});

test("topComments does not claim a popularity ranking when counts are absent", () => {
  const result = topComments([{ id: "1", text: "First" }, { id: "2", text: "Second" }]);
  assert.equal(result.rankedByLikes, false);
  assert.deepEqual(result.comments.map((item) => item.id), ["1", "2"]);
  assert.equal(result.status, "available");
});
