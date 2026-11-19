/**
 * Apply admin overrides onto process.env (secrets, DEMO_MODE) and plan prices.
 * Original env values are remembered so clearing an override restores Render's value.
 */
import { SECRET_DEFS } from "../admin/secrets-def";
import type { SiteSettings } from "./types";
import { setPriceOverrides } from "./prices";
import { applyPools } from "../pools/apply";

const g = globalThis as unknown as { __frostlyEnvOrig?: Record<string, string | undefined> };

const MANAGED = [...SECRET_DEFS.map((d) => d.env), "DEMO_MODE", "RELAY_URL", "SITE_URL"];

function originals() {
  if (!g.__frostlyEnvOrig) {
    g.__frostlyEnvOrig = {};
    for (const k of MANAGED) g.__frostlyEnvOrig[k] = process.env[k];
  }
  return g.__frostlyEnvOrig;
}

const setEnv = (k: string, v: string | undefined) => {
  if (v === undefined || v === "") delete process.env[k];
  else process.env[k] = v;
};

export function applyOverrides(settings: SiteSettings, secrets: Record<string, string>) {
  const orig = originals();
  for (const d of SECRET_DEFS) setEnv(d.env, secrets[d.key] ? secrets[d.key] : orig[d.env]);
  setEnv("DEMO_MODE", settings.features.demoMode || orig.DEMO_MODE);
  setEnv("RELAY_URL", settings.relayUrl || orig.RELAY_URL);
  setEnv("SITE_URL", settings.publicUrl || orig.SITE_URL);
  setPriceOverrides(settings.features.prices);
  applyPools(secrets);
}

/** Value Render had at boot for an env var (to show where an effective value comes from). */
export const originalEnv = (k: string): string | undefined => originals()[k];

