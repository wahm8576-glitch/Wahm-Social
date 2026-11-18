import { test } from "node:test";
import assert from "node:assert/strict";
import { isInstagramHost } from "../src/lib/server/http";

test("isInstagramHost covers instagram.com and its CDNs only", () => {
  for (const u of ["https://www.instagram.com/api/v1/x", "https://i.instagram.com/api/v1/x", "https://instagram.com/p/x/", "https://scontent-fra5-1.cdninstagram.com/a.jpg", "https://scontent.xx.fbcdn.net/a.jpg"])
    assert.equal(isInstagramHost(u), true, u);
  for (const u of ["https://www.tiktok.com/@a", "https://evilinstagram.com/", "https://instagram.com.evil.io/", "not a url"])
    assert.equal(isInstagramHost(u), false, u);
});

import { parseIgCookieEnv, igSessionToken, stripCookieJunk } from "../src/lib/platforms/instagram/session/cookie-env";

test("parseIgCookieEnv accepts a bare session token", () => {
  const bag = parseIgCookieEnv("12345%3AAbCdEf~xyz");
  assert.equal(bag.sessionid, "12345%3AAbCdEf~xyz");
  assert.equal(igSessionToken("12345%3AAbCdEf~xyz"), "12345%3AAbCdEf~xyz");
});

test("parseIgCookieEnv extracts sessionid from a pasted cookie header and drops JSON junk", () => {
  const raw = '12345%3AAbCdEf; ds_user_id=12345; csrftoken=abc123; mid=Yxxxx; datr=zzzz; ig_did=11111111-1111-1111-1111-111111111111; wd=1280x720"}]';
  const bag = parseIgCookieEnv(raw);
  assert.equal(bag.sessionid, "12345%3AAbCdEf");
  assert.ok(!bag.sessionid.includes(";"), "sessionid must be a single token");
  assert.equal(bag.ds_user_id, "12345");
  assert.equal(bag.csrftoken, "abc123");
  assert.equal(bag.mid, "Yxxxx");
  assert.equal(bag.ig_did, "11111111-1111-1111-1111-111111111111");
  assert.equal(bag.wd, "1280x720");
  assert.equal(stripCookieJunk('cookie"}]'), "cookie");
});

test("parseIgCookieEnv handles sessionid= key form", () => {
  const bag = parseIgCookieEnv("sessionid=abc%3Adef; ds_user_id=9");
  assert.equal(bag.sessionid, "abc%3Adef");
  assert.equal(bag.ds_user_id, "9");
});
