import { test } from "node:test";
import assert from "node:assert/strict";
import { maskIp, maskProxyUrl, describeEntry } from "../src/lib/pools/mask";
import { normalizeProxyLine, validateProxy } from "../src/lib/pools/validate";
import { applyOp, currentList, writeList } from "../src/lib/pools/ops";
import { seedFromEnv, storedPool } from "../src/lib/pools/read";
import { scrub } from "../src/lib/server/errorLog";

test("maskProxyUrl hides the password and most of the username", () => {
  const m = maskProxyUrl("http://ymnlsmha-rotate:secretpw@p.webshare.io:80/");
  assert.equal(m, "http://ymn••••:••••@p.webshare.io:80");
  assert.ok(!m.includes("secretpw"));
  assert.equal(maskIp("191.96.254.138"), "191.96.x.x");
});

test("normalizeProxyLine accepts curl lines and host:port:user:pass", () => {
  assert.equal(normalizeProxyLine('curl --proxy "http://u:p@1.2.3.4:6185/" https://ipv4.webshare.io/'), "http://u:p@1.2.3.4:6185");
  assert.equal(normalizeProxyLine("1.2.3.4:6185:user:pass"), "http://user:pass@1.2.3.4:6185");
  assert.equal(validateProxy("socks5://a:b@h:1"), "البروكسي لازم يبدأ بـ http:// أو https:// (SOCKS غير مدعوم حالياً)");
  assert.equal(validateProxy("http://u:p@h:80"), null);
});

test("pools seed from env, then reorder / toggle / delete in place", () => {
  const env = { SCRAPER_PROXY: "http://a:b@h1:1,http://c:d@h2:2" } as unknown as NodeJS.ProcessEnv;
  const secrets: Record<string, string> = {};
  assert.equal(storedPool(secrets, "proxies"), null);
  const seeded = currentList(secrets, "proxies", env);
  assert.equal(seeded.length, 2);
  let list = applyOp(seeded, "down", "env0");
  assert.deepEqual(list.map((e) => e.id), ["env1", "env0"]);
  list = applyOp(list, "toggle", "env1");
  assert.equal(list[0].enabled, false);
  writeList(secrets, "proxies", applyOp(list, "delete", "env0"));
  assert.equal(storedPool(secrets, "proxies")!.length, 1);
  assert.deepEqual(seedFromEnv("tiktok", {} as NodeJS.ProcessEnv), []);
});

test("session descriptions never include values", () => {
  const d = describeEntry("tiktok", { id: "a", label: "", enabled: true, cookie: "sessionid=SECRETVALUE123; msToken=XYZ" });
  assert.ok(!d.includes("SECRETVALUE123") && !d.includes("XYZ"));
  const i = describeEntry("instagram", { id: "b", label: "", enabled: true, ig: { sessionid: "123%3Aabcdef" } });
  assert.ok(!i.includes("abcdef"));
});

test("error log scrubbing removes credentials", () => {
  const s = scrub("failed http://user:pw@1.2.3.4:80 sessionid=abc123; msToken=zzz");
  assert.ok(!s.includes("pw@") && !s.includes("abc123") && !s.includes("zzz"));
});

import { parseIgCookieEnv, igSessionToken, sessionTag } from "../src/lib/platforms/instagram/session/cookie-env";
import { mergedPool } from "../src/lib/pools/read";
import { buildEntries } from "../src/lib/pools/build";
import { classifySessionError, healthOf, isUsable, loadHealth, MIN_GAP_MS, pickSession, recordFailure, recordSuccess } from "../src/lib/pools/runtime";
import type { PoolEntry } from "../src/lib/pools/types";

test("parseIgCookieEnv accepts sessionid= alone, Netscape lines, and bare tokens", () => {
  assert.equal(parseIgCookieEnv("sessionid=abc%3Adef").sessionid, "abc%3Adef");
  const netscape = "sessionid = tok123\nds_user_id = 99\ncsrftoken = csrf1\ndomain=.instagram.com";
  const bag = parseIgCookieEnv(netscape);
  assert.equal(bag.sessionid, "tok123");
  assert.equal(bag.ds_user_id, "99");
  assert.equal(bag.csrftoken, "csrf1");
  assert.equal(igSessionToken("plainTokenOnly"), "plainTokenOnly");
});

test("sessionTag logs label and last 4 chars only", () => {
  const t = sessionTag("حسابي", "12345%3AabcdefXYZ9", "id1");
  assert.equal(t, "حسابي …XYZ9");
  assert.ok(!t.includes("12345"));
  assert.ok(!t.includes("abcdef"));
});

test("mergedPool keeps the env Instagram session alongside stored ones", () => {
  const env = { IG_SESSIONID: "envtokenAAA", IG_CSRFTOKEN: "c" } as unknown as NodeJS.ProcessEnv;
  const secrets: Record<string, string> = {
    pool_instagram: JSON.stringify([{ id: "p1", label: "احتياط", enabled: true, ig: { sessionid: "othertokenBBB" } }]),
  };
  const list = mergedPool(secrets, "instagram", env);
  const ids = list.map((e) => e.id);
  assert.ok(ids.includes("p1") && ids.includes("env0"));
  assert.equal(list.find((e) => e.id === "env0")?.ig?.sessionid, "envtokenAAA");
  // same token is not duplicated
  const dup = mergedPool({ pool_instagram: JSON.stringify([{ id: "p2", label: "x", enabled: true, ig: { sessionid: "envtokenAAA" } }]) }, "instagram", env);
  assert.equal(dup.length, 1);
});

test("buildEntries parses a full Instagram cookie header pasted in the cookie field", () => {
  const f = new FormData();
  f.set("label", "احتياط 2");
  f.set("cookie", "sessionid=s1%3Aab; ds_user_id=42; csrftoken=tok; mid=mm; datr=dd");
  const [e] = buildEntries("instagram", f);
  assert.equal(e.label, "احتياط 2");
  assert.equal(e.ig?.sessionid, "s1%3Aab");
  assert.equal(e.ig?.dsUserId, "42");
  assert.equal(e.ig?.csrftoken, "tok");
});

test("session picker skips dead and cooling sessions, then LRU", () => {
  const a: PoolEntry = { id: "a", label: "A", enabled: true, ig: { sessionid: "tokAAAA" } };
  const b: PoolEntry = { id: "b", label: "B", enabled: true, ig: { sessionid: "tokBBBB" } };
  const c: PoolEntry = { id: "c", label: "C", enabled: true, ig: { sessionid: "tokCCCC" } };
  loadHealth("instagram", {
    a: { id: "a", state: "dead" },
    b: { id: "b", state: "cooldown", cooldownUntil: Date.now() + 60_000 },
  });
  const picked = pickSession("instagram", [a, b, c], new Set(), Date.now());
  assert.equal(picked?.id, "c");
  recordSuccess("instagram", c);
  const again = pickSession("instagram", [a, b, c], new Set(), Date.now());
  // just used c, and a/b unusable — c still only option but min-gap may exclude it
  if (!again) {
    const later = pickSession("instagram", [a, b, c], new Set(), Date.now() + MIN_GAP_MS + 1);
    assert.equal(later?.id, "c");
  } else {
    assert.equal(again.id, "c");
  }
});

test("429 marks cooldown, login_required marks dead; classify is secret-safe", () => {
  assert.equal(classifySessionError("rate_limited", 429), "rate");
  assert.equal(classifySessionError("We're sorry, but something went wrong.", 200), "rate");
  assert.equal(classifySessionError("login_required", 400), "dead");
  const e: PoolEntry = { id: "z", label: "Zed", enabled: true, ig: { sessionid: "supersecretTOKEN99" } };
  recordFailure("instagram", e, "rate_limited", 429);
  const h = healthOf("instagram", "z");
  assert.equal(h.state, "cooldown");
  assert.ok((h.cooldownUntil ?? 0) > Date.now());
  assert.equal(isUsable(h, true), false);
  recordFailure("instagram", e, "login_required", 403);
  assert.equal(healthOf("instagram", "z").state, "dead");
  assert.ok(!JSON.stringify(healthOf("instagram", "z")).includes("supersecret"));
});
