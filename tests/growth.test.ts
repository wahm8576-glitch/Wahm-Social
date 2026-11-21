import { test } from "node:test";
import assert from "node:assert/strict";
import { appendDailyGrowth } from "../src/lib/growth";

const utc = (day: number, hour = 12) => Date.UTC(2026, 0, day, hour);

test("stores at most one snapshot per UTC day and keeps the latest check for that day", () => {
  const first = { at: utc(1), followers: 100, likes: 200, postsCount: 10 };
  const sameDay = { at: utc(1, 20), followers: 105, likes: 210, postsCount: 11 };
  const nextDay = { at: utc(2), followers: 120, likes: 240, postsCount: 12 };

  assert.deepEqual(appendDailyGrowth([first], sameDay), [sameDay]);
  assert.deepEqual(appendDailyGrowth([first], nextDay), [first, nextDay]);
});

test("orders samples chronologically and prunes to the configured limit", () => {
  const history = [
    { at: utc(3), followers: 30 },
    { at: utc(1), followers: 10 },
    { at: utc(2), followers: 20 },
  ];
  assert.deepEqual(appendDailyGrowth(history, { at: utc(4), followers: 40 }, 3), [
    { at: utc(2), followers: 20 },
    { at: utc(3), followers: 30 },
    { at: utc(4), followers: 40 },
  ]);
});

test("ignores invalid observations and optional metrics", () => {
  assert.deepEqual(appendDailyGrowth(undefined, { at: utc(1), followers: -1 }), []);
  assert.deepEqual(appendDailyGrowth(undefined, { at: utc(1), followers: 1, likes: Number.NaN, postsCount: 3 }), [
    { at: utc(1), followers: 1, postsCount: 3 },
  ]);
});
