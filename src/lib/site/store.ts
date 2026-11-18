import { dataStore, SECRETS_FILE, SETTINGS_FILE, ASSET_DIR } from "../admin/storage";
import { seal, unseal, type Sealed } from "../admin/crypto";
import { DEFAULT_SETTINGS, mergeSettings } from "./defaults";
import { applyOverrides } from "./apply";
import { setSnapshot, snapshot } from "./snapshot";
import type { SiteSettings } from "./types";
import { hydrateHealthFromFirestore, hydratePoolsFromFirestore, persistHealthToFirestore, persistPoolsToFirestore } from "../pools/persist";

const TTL_MS = 45_000;
const g = globalThis as unknown as { __frostlySiteLoad?: Promise<void> | null; __frostlyLoadOk?: boolean };

function parseSecrets(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(unseal(JSON.parse(raw) as Sealed)) as Record<string, string>;
  } catch {
    throw new Error("تعذر فك تشفير الأسرار (هل تغيّر JWT_SECRET؟)");
  }
}

async function load(): Promise<void> {
  try {
    const { settings, secrets } = await dataStore().readAll();
    const s = mergeSettings(DEFAULT_SETTINGS, settings ? JSON.parse(settings) : {});
    let sec = snapshot().secrets;
    let error = "";
    try {
      sec = parseSecrets(secrets);
    } catch (e) {
      error = (e as Error).message;
    }
    try {
      if (await hydratePoolsFromFirestore(sec)) {
        /* pools recovered from Firestore when the data repo copy was empty */
      }
      await hydrateHealthFromFirestore();
    } catch { /* optional */ }
    applyOverrides(s, sec);
    setSnapshot({ settings: s, secrets: sec, loadedAt: Date.now(), error });
    g.__frostlyLoadOk = true;
  } catch (e) {
    g.__frostlyLoadOk = false;
    // Keep the last good copy; retry sooner.
    setSnapshot({ loadedAt: Date.now() - TTL_MS + 10_000, error: (e as Error).message });
  }
}

/** Kick a reload (deduplicated). */
export function refreshSettings(): Promise<void> {
  return (g.__frostlySiteLoad ??= load().finally(() => {
    g.__frostlySiteLoad = null;
  }));
}

/**
 * Settings for rendering: waits only on the very first load (cold start, max ~8s),
 * afterwards serves the snapshot and revalidates in the background (stale-while-revalidate).
 */
export async function getSettings(): Promise<SiteSettings> {
  const snap = snapshot();
  if (!snap.loadedAt) {
    await Promise.race([refreshSettings(), new Promise((r) => setTimeout(r, 8000))]);
  } else if (Date.now() - snap.loadedAt > TTL_MS) {
    void refreshSettings();
  }
  return snapshot().settings;
}

async function persist(settings: SiteSettings, secrets: Record<string, string>, extra: Record<string, Buffer | string | null>, message: string) {
  const files: Record<string, Buffer | string | null> = {
    [SETTINGS_FILE]: JSON.stringify(settings, null, 2) + "\n",
    [SECRETS_FILE]: JSON.stringify(seal(JSON.stringify(secrets))) + "\n",
    ...extra,
  };
  await dataStore().write(files, message);
  applyOverrides(settings, secrets);
  setSnapshot({ settings, secrets, loadedAt: Date.now(), error: "" });
  void persistPoolsToFirestore(secrets);
  void persistHealthToFirestore();
}

/** Fresh copy straight from storage before a write (avoid clobbering a concurrent edit). */
async function fresh() {
  await refreshSettings();
  const snap = snapshot();
  if (!g.__frostlyLoadOk) throw new Error(`تعذر قراءة الإعدادات من التخزين: ${snap.error || "unknown"}`);
  return snap;
}

export async function saveSettings(mutate: (s: SiteSettings) => SiteSettings, message: string, extra: Record<string, Buffer | string | null> = {}) {
  const snap = await fresh();
  const next = mergeSettings(DEFAULT_SETTINGS, mutate(structuredClone(snap.settings)));
  next.updatedAt = new Date().toISOString();
  await persist(next, snap.secrets, extra, message);
}

export async function saveSecrets(mutate: (s: Record<string, string>) => Record<string, string>, message: string) {
  const snap = await fresh();
  const next = mutate({ ...snap.secrets });
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  await persist(snap.settings, next, {}, message);
}

export async function readAsset(name: string): Promise<Buffer | null> {
  if (!/^[a-z0-9._-]+$/i.test(name)) return null;
  return dataStore().readAsset(name);
}

export const assetPath = (name: string) => `${ASSET_DIR}/${name}`;
