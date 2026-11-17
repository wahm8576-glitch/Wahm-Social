import "server-only";
/**
 * One Chromium at a time across the whole app (TikTok followers + Instagram session share this),
 * because the free 512 MB instance cannot run two. After a failed run, wait before launching again.
 */
const g = globalThis as unknown as { __browserBusy?: boolean; __browserFailAt?: number };
const COOLDOWN_MS = 3 * 60_000;

export async function browserLock<T>(fn: () => Promise<T>): Promise<T | "busy"> {
  if (g.__browserBusy) return "busy";
  if (g.__browserFailAt && Date.now() - g.__browserFailAt < COOLDOWN_MS) return "busy";
  g.__browserBusy = true;
  try {
    const r = await fn();
    g.__browserFailAt = undefined;
    return r;
  } catch (e) {
    g.__browserFailAt = Date.now();
    throw e;
  } finally {
    g.__browserBusy = false;
  }
}
