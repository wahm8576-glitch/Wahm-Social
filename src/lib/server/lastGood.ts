import "server-only";
/**
 * Last good copy of each profile, kept in memory (24h, via cache "stale:") AND in Firestore
 * (collection "profiles", at most one write per key every 30 minutes — Spark quota friendly),
 * so a restart or a full upstream outage still shows the last real data instead of an error.
 */
import { firestoreConfigured, lastGoodRead, lastGoodWrite } from "./firestoreStore";
import { safeDocId } from "./mirror";

const WRITE_EVERY_MS = 30 * 60_000;
const MAX_AGE_MS = 14 * 24 * 3600_000;
const lastWrite = new Map<string, number>();
const on = () => process.env.LAST_GOOD_FIRESTORE !== "0" && firestoreConfigured();

export function saveLastGood(key: string, value: unknown) {
  if (!on()) return;
  const now = Date.now();
  if (now - (lastWrite.get(key) ?? 0) < WRITE_EVERY_MS) return;
  lastWrite.set(key, now);
  if (lastWrite.size > 5000) lastWrite.delete(lastWrite.keys().next().value as string);
  void lastGoodWrite(safeDocId(key), key, JSON.stringify(value)).catch(() => lastWrite.delete(key));
}

export async function loadLastGood<T>(key: string, waitMs = 3000): Promise<{ value: T; at: number } | null> {
  if (!on()) return null;
  const read = lastGoodRead(safeDocId(key))
    .then((r) => (r && Date.now() - r.at < MAX_AGE_MS ? { value: JSON.parse(r.json) as T, at: r.at } : null))
    .catch(() => null);
  return Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
}
