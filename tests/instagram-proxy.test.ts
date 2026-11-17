import { test } from "node:test";
import assert from "node:assert/strict";
import { isInstagramHost } from "../src/lib/server/http";

test("isInstagramHost covers instagram.com and its CDNs only", () => {
  for (const u of ["https://www.instagram.com/api/v1/x", "https://i.instagram.com/api/v1/x", "https://instagram.com/p/x/", "https://scontent-fra5-1.cdninstagram.com/a.jpg", "https://scontent.xx.fbcdn.net/a.jpg"])
    assert.equal(isInstagramHost(u), true, u);
  for (const u of ["https://www.tiktok.com/@a", "https://evilinstagram.com/", "https://instagram.com.evil.io/", "not a url"])
    assert.equal(isInstagramHost(u), false, u);
});
