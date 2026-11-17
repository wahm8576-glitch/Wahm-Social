/**
 * Load admin settings once at startup and refresh them every minute, so API routes
 * (proxy, sessions, toggles) see panel edits even without a page render.
 */
import { refreshSettings } from "./lib/site/store";
import { initRemoteStore } from "./lib/server/db";

// Settings first (a service account may be stored in the panel), then load user data from Firestore.
export async function boot() {
  await refreshSettings().catch(() => {});
  await initRemoteStore().catch((e) => console.error("[db] remote init failed", e));
}
const g = globalThis as unknown as { __frostlyTimer?: NodeJS.Timeout };
if (!g.__frostlyTimer) {
  g.__frostlyTimer = setInterval(() => void refreshSettings(), 60_000);
  g.__frostlyTimer.unref?.();
}
