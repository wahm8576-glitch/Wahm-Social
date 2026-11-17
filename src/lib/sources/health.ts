/**
 * Per-source health: success/failure counters, average latency, a circuit breaker
 * (3 failures in a row → skip the source for a few minutes) and a log of which source served each request.
 * In-memory per instance; shown in the admin panel "مصادر البيانات".
 */
export interface SourceStat {
  id: string;
  ok: number;
  fail: number;
  streak: number;
  avgMs: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastError?: string;
  openUntil?: number;
}

export interface ServedEntry {
  at: number;
  key: string; // e.g. "profile:tiktok:mrbeast"
  source: string; // winning source id, "cache", "stale" or "none"
  ms: number;
  tried: string[]; // "id:ok|fail|skip|timeout"
}

const BREAK_AFTER = 3;
const OPEN_MS = 5 * 60_000;

const g = globalThis as unknown as { __srcStats?: Map<string, SourceStat>; __srcServed?: ServedEntry[] };
const stats = (g.__srcStats ??= new Map());
const served = (g.__srcServed ??= []);

function stat(id: string): SourceStat {
  let s = stats.get(id);
  if (!s) stats.set(id, (s = { id, ok: 0, fail: 0, streak: 0, avgMs: 0 }));
  return s;
}

export function circuitOpen(id: string, now = Date.now()): boolean {
  const s = stats.get(id);
  return !!s?.openUntil && s.openUntil > now;
}

export function recordOk(id: string, ms: number) {
  const s = stat(id);
  s.ok++;
  s.streak = 0;
  s.openUntil = undefined;
  s.lastOkAt = Date.now();
  s.avgMs = s.avgMs ? Math.round(s.avgMs * 0.7 + ms * 0.3) : ms;
}

/** `soft` failures (e.g. "account not found here") don't count toward the breaker. */
export function recordFail(id: string, ms: number, error: string, soft = false) {
  const s = stat(id);
  s.fail++;
  s.lastFailAt = Date.now();
  s.lastError = error.slice(0, 140);
  s.avgMs = s.avgMs ? Math.round(s.avgMs * 0.7 + ms * 0.3) : ms;
  if (soft) return;
  s.streak++;
  if (s.streak >= BREAK_AFTER) s.openUntil = Date.now() + OPEN_MS;
}

export function recordServed(e: ServedEntry) {
  served.unshift(e);
  if (served.length > 100) served.length = 100;
}

export const sourceStats = () => [...stats.values()].sort((a, b) => a.id.localeCompare(b.id));
export const servedLog = () => served.slice();
export function resetCircuits() {
  for (const s of stats.values()) (s.openUntil = undefined), (s.streak = 0);
}
