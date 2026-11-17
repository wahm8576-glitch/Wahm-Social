import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSources, SourceMiss, NotFoundHere } from "../src/lib/sources/run";
import { circuitOpen, servedLog, sourceStats, resetCircuits } from "../src/lib/sources/health";
import { parseDumpor, parseIgOembed } from "../src/lib/platforms/instagram/mirrors-parse";
import { profileFromCountik } from "../src/lib/platforms/tiktok/countik-parse";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("runSources: first source fails fast, second wins; served log records the winner", async () => {
  const r = await runSources("t:1", [
    { id: "a1", timeoutMs: 500, run: async () => { throw new Error("boom"); } },
    { id: "b1", timeoutMs: 500, run: async () => "B" },
  ]);
  assert.deepEqual(r, { value: "B", source: "b1" });
  assert.equal(servedLog()[0].source, "b1");
  assert.deepEqual(servedLog()[0].tried, ["a1:fail", "b1:ok"]);
});

test("runSources: a slow source does not hold the page (stagger starts the next one)", async () => {
  const t0 = Date.now();
  const r = await runSources("t:2", [
    { id: "slow2", timeoutMs: 2000, run: async () => { await wait(1500); return "slow"; } },
    { id: "fast2", timeoutMs: 500, run: async () => "fast" },
  ], { staggerMs: 100 });
  assert.equal(r.source, "fast2");
  assert.ok(Date.now() - t0 < 1000);
});

test("runSources: per-source timeout and all-not-found → SourceMiss.notFound", async () => {
  await assert.rejects(
    runSources("t:3", [
      { id: "nf3", timeoutMs: 500, run: async () => { throw new NotFoundHere(); } },
      { id: "nf3b", timeoutMs: 500, run: async () => { throw new NotFoundHere(); } },
    ]),
    (e: unknown) => e instanceof SourceMiss && e.notFound,
  );
  await assert.rejects(
    runSources("t:3b", [{ id: "to3", timeoutMs: 50, run: async () => { await wait(300); return 1; } }]),
    (e: unknown) => e instanceof SourceMiss && !e.notFound && e.tried[0] === "to3:timeout",
  );
});

test("circuit breaker opens after 3 hard failures and the source is skipped", async () => {
  resetCircuits();
  const bad = { id: "cb4", timeoutMs: 200, run: async (): Promise<string | null> => { throw new Error("x"); } };
  for (let i = 0; i < 3; i++) await runSources("t:4", [bad]).catch(() => undefined);
  assert.equal(circuitOpen("cb4"), true);
  let called = false;
  const r = await runSources("t:4", [{ ...bad, run: async () => { called = true; return "no"; } }, { id: "ok4", timeoutMs: 200, run: async () => "yes" }]);
  assert.equal(called, false);
  assert.equal(r.source, "ok4");
  assert.equal(sourceStats().find((s) => s.id === "cb4")?.fail, 3);
});

test("parseDumpor reads name, bio, verified, avatar and rounded counts", () => {
  const p = parseDumpor(readFileSync("tests/fixtures/dumpor-natgeo.html", "utf8"), "natgeo");
  assert.ok(p);
  assert.equal(p!.username, "natgeo");
  assert.equal(p!.displayName, "National Geographic");
  assert.equal(p!.verified, true);
  assert.equal(p!.followers, 268_100_000);
  assert.equal(p!.following, 195);
  assert.equal(p!.postsCount, 32_100);
  assert.match(p!.avatarUrl, /^https:\/\/media\.dumpor\.io\//);
  assert.match(p!.bio, /National Geographic/);
  assert.equal(parseDumpor("<h1>@someoneelse</h1>", "natgeo"), null);
});

test("parseIgOembed and profileFromCountik", () => {
  const o = parseIgOembed(JSON.stringify({ author_name: "natgeo", title: "National Geographic's (@natgeo) profile on Instagram", thumbnail_url: "https://x.cdninstagram.com/a.jpg" }), "natgeo");
  assert.deepEqual(o, { displayName: "National Geographic", avatarUrl: "https://x.cdninstagram.com/a.jpg" });
  assert.equal(parseIgOembed("<html>", "natgeo"), null);
  const c = profileFromCountik({ status: "success", id: "66", uniqueId: "mrbeast", nickname: "MrBeast", followerCount: 146971519, followingCount: 346, heartCount: 1573944356, videoCount: 507, sec_uid: "MS4", language: "en", verified: false }, "mrbeast");
  assert.equal(c?.followers, 146971519);
  assert.equal(c?.secUid, "MS4");
  assert.equal(c?.postsCount, 507);
  assert.equal(profileFromCountik({ status: "error" }, "x"), null);
});

test("free TikTok parsers: story API items and SaveTik download tokens", async () => {
  const { storiesFromTikTokApi, parseSaveTik } = await import("../src/lib/platforms/tiktok/free-parse");
  const s = storiesFromTikTokApi(
    { itemList: [{ id: "77", createTime: 1794946000, author: { uniqueId: "riyadhseason" }, video: { playAddr: "https://v16-webapp-prime.tiktok.com/v.mp4", originCover: "https://p16.tiktokcdn.com/c.jpg" } }, { id: "78", secret: true, video: { playAddr: "x" } }] },
    "riyadhseason",
  );
  assert.equal(s.length, 1);
  assert.equal(s[0].type, "video");
  assert.equal(s[0].expiresAt, 1794946000 + 86400);
  const tok = (url: string, filename: string) =>
    `https://dl.snapcdn.app/get?token=x.${Buffer.from(JSON.stringify({ url, filename })).toString("base64url")}.y`;
  const html = `<h3>Hello</h3><a href="${tok("https://v19.tiktokcdn-us.com/a.mp4", "SaveTik.co_1.mp4")}">MP4</a><a href="${tok("https://v16.tokcdn.com/1_original.mp4", "SaveTik.co_1-hd.mp4")}">HD</a><a href="${tok("https://v16-ies-music.tiktokcdn-us.com/m.mp3", "SaveTik.co_1.mp3")}">MP3</a>`;
  assert.deepEqual(parseSaveTik(html), { play: "https://v19.tiktokcdn-us.com/a.mp4", hd: "https://v16.tokcdn.com/1_original.mp4", music: "https://v16-ies-music.tiktokcdn-us.com/m.mp3", title: "Hello" });
  assert.equal(parseSaveTik("<div>nothing</div>"), null);
});
