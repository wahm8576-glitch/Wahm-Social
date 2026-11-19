import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/lib/site/defaults";
import { setSnapshot, snapshot } from "../src/lib/site/snapshot";
import {
  billingReturnUrls,
  configuredOrigin,
  normalizeOrigin,
  publicSiteUrl,
  telegramWebhookUrl,
} from "../src/lib/site/publicUrl";

function headers(h: Record<string, string>) {
  return { headers: { get(name: string) { return h[name.toLowerCase()] ?? h[name] ?? null; } } };
}

describe("public site URL", () => {
  test("normalizeOrigin strips a trailing slash and requires http(s)", () => {
    assert.equal(normalizeOrigin("https://example.com/"), "https://example.com");
    assert.equal(normalizeOrigin("example.com"), "https://example.com");
    assert.equal(normalizeOrigin("ftp://x"), "");
    assert.equal(normalizeOrigin(""), "");
  });

  test("admin publicUrl pins the origin; request host is used when unpinned", () => {
    const prev = snapshot();
    const envSite = process.env.SITE_URL;
    const envNext = process.env.NEXT_PUBLIC_SITE_URL;
    const envRender = process.env.RENDER_EXTERNAL_URL;
    const envRenderFlag = process.env.RENDER;
    try {
      delete process.env.SITE_URL;
      delete process.env.NEXT_PUBLIC_SITE_URL;
      process.env.RENDER_EXTERNAL_URL = "https://app.onrender.com";
      process.env.RENDER = "true";
      setSnapshot({ settings: { ...DEFAULT_SETTINGS, publicUrl: "" } });
      assert.equal(configuredOrigin(), "");
      assert.equal(
        publicSiteUrl(headers({ "x-forwarded-host": "custom.example", "x-forwarded-proto": "https" })),
        "https://custom.example",
      );
      assert.equal(publicSiteUrl(), "https://app.onrender.com");
      setSnapshot({ settings: { ...DEFAULT_SETTINGS, publicUrl: "https://pinned.example/" } });
      assert.equal(configuredOrigin(), "https://pinned.example");
      assert.equal(
        publicSiteUrl(headers({ "x-forwarded-host": "custom.example", "x-forwarded-proto": "https" })),
        "https://pinned.example",
      );
      const returns = billingReturnUrls(headers({ "x-forwarded-host": "custom.example", "x-forwarded-proto": "https" }) as any);
      assert.equal(returns.returnUrl, "https://pinned.example/account?upgraded=1");
      assert.equal(returns.cancelUrl, "https://pinned.example/pricing?canceled=1");
      assert.equal(telegramWebhookUrl(), "https://pinned.example/api/telegram/webhook");
      assert.doesNotMatch(telegramWebhookUrl(), /wahm-social\.onrender\.com/);
    } finally {
      setSnapshot({ settings: prev.settings, secrets: prev.secrets, loadedAt: prev.loadedAt, error: prev.error });
      if (envSite === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = envSite;
      if (envNext === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = envNext;
      if (envRender === undefined) delete process.env.RENDER_EXTERNAL_URL;
      else process.env.RENDER_EXTERNAL_URL = envRender;
      if (envRenderFlag === undefined) delete process.env.RENDER;
      else process.env.RENDER = envRenderFlag;
    }
  });
});
