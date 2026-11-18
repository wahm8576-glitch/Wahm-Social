/**
 * Runtime health and LRU/round-robin picking for Instagram / TikTok session pools.
 * Health maps never store cookie values. Logs use label + last 4 chars only.
 */
import type { IgCookies, PoolEntry } from "./types";
import type { PoolKind } from "./types";
import { sessionTag } from "../platforms/instagram/session/cookie-env";

export type SessionKind = Extract<PoolKind, "tiktok" | "instagram">;
export type SessionHealthState = "ok" | "cooldown" | "dead" | "disabled";

export interface SessionHealth {
  id: string;
  state: SessionHealthState;
  cooldownUntil?: number;
  backoffMs?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastUsedAt?: number;
  requestsToday?: number;
  requestsHour?: number;
  hourStart?: number;
  dayKey?: string;
  /** Public username of the account that owns the session (not a secret). */
  account?: string;
}

export const MIN_GAP_MS = 2_500;
export const HOURLY_CAP = 40;
export const BACKOFF_START_MS = 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;

const g = globalThis as unknown as { __frostlySessHealth?: Record<SessionKind, Record<string, SessionHealth>> };
const store = () => (g.__frostlySessHealth ??= { instagram: {}, tiktok: {} });

export function dayKey(at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

function roll(h: SessionHealth): SessionHealth {
  const day = dayKey();
  if (h.dayKey !== day) {
    h.dayKey = day;
    h.requestsToday = 0;
  }
  if (!h.hourStart || Date.now() - h.hourStart >= 3_600_000) {
    h.hourStart = Date.now();
    h.requestsHour = 0;
  }
  return h;
}

export function healthOf(kind: SessionKind, id: string): SessionHealth {
  const map = store()[kind];
  return roll(map[id] ?? (map[id] = { id, state: "ok", dayKey: dayKey(), requestsToday: 0, requestsHour: 0, hourStart: Date.now() }));
}

export function snapshotHealth(kind: SessionKind): Record<string, SessionHealth> {
  return { ...store()[kind] };
}

export function loadHealth(kind: SessionKind, rows: Record<string, SessionHealth>) {
  const map = store()[kind];
  for (const [id, h] of Object.entries(rows ?? {})) {
    if (!id || !h || typeof h !== "object") continue;
    map[id] = roll({
      id,
      state: h.state === "dead" || h.state === "cooldown" || h.state === "disabled" ? h.state : "ok",
      cooldownUntil: h.cooldownUntil,
      backoffMs: h.backoffMs,
      lastSuccessAt: h.lastSuccessAt,
      lastErrorAt: h.lastErrorAt,
      lastError: typeof h.lastError === "string" ? h.lastError.slice(0, 80) : undefined,
      lastUsedAt: h.lastUsedAt,
      requestsToday: h.requestsToday,
      requestsHour: h.requestsHour,
      hourStart: h.hourStart,
      dayKey: h.dayKey,
      account: typeof h.account === "string" ? h.account.slice(0, 40) : undefined,
    });
  }
}

export function classifySessionError(note: string, status: number): "ok" | "rate" | "dead" | "other" {
  const n = note.toLowerCase();
  if (status === 401 || /login_required|checkpoint|challenge|login_redirect|logged_out/.test(n)) return "dead";
  if (status === 429 || /rate[_ ]?limit|sorry|something went wrong/.test(n)) return "rate";
  return "other";
}

export function recordSuccess(kind: SessionKind, entry: PoolEntry, account?: string) {
  const h = healthOf(kind, entry.id);
  h.state = "ok";
  h.lastSuccessAt = Date.now();
  h.lastUsedAt = Date.now();
  h.backoffMs = BACKOFF_START_MS;
  h.cooldownUntil = undefined;
  h.requestsToday = (h.requestsToday ?? 0) + 1;
  h.requestsHour = (h.requestsHour ?? 0) + 1;
  if (account) h.account = account.replace(/^@/, "").slice(0, 40);
  console.info(`[pool] ${kind} ${tag(kind, entry)} result=ok reqToday=${h.requestsToday}`);
}

export function recordFailure(kind: SessionKind, entry: PoolEntry, note: string, status: number) {
  const h = healthOf(kind, entry.id);
  const kindErr = classifySessionError(note, status);
  h.lastErrorAt = Date.now();
  h.lastError = `${status || ""} ${note}`.trim().slice(0, 80);
  h.lastUsedAt = Date.now();
  h.requestsToday = (h.requestsToday ?? 0) + 1;
  h.requestsHour = (h.requestsHour ?? 0) + 1;
  if (kindErr === "dead") {
    h.state = "dead";
    h.cooldownUntil = undefined;
    console.warn(`[pool] ${kind} ${tag(kind, entry)} result=dead note=${h.lastError}`);
    return "dead" as const;
  }
  const prev = h.backoffMs ?? BACKOFF_START_MS;
  // first rate-limit starts at BACKOFF_START; subsequent multiply
  const wait = kindErr === "rate" ? (h.state === "cooldown" ? Math.min(BACKOFF_MAX_MS, prev * 2) : BACKOFF_START_MS) : Math.min(5 * 60_000, BACKOFF_START_MS);
  h.backoffMs = wait;
  h.state = "cooldown";
  h.cooldownUntil = Date.now() + wait;
  console.warn(`[pool] ${kind} ${tag(kind, entry)} result=${kindErr} cooldown=${Math.round(wait / 1000)}s note=${h.lastError}`);
  return kindErr;
}

function tag(kind: SessionKind, e: PoolEntry): string {
  const token = kind === "instagram" ? e.ig?.sessionid : (e.cookie ?? "");
  return sessionTag(e.label, token, e.id);
}

export function isUsable(h: SessionHealth, enabled: boolean, now = Date.now()): boolean {
  if (!enabled) return false;
  if (h.state === "dead") return false;
  if (h.state === "cooldown" && (h.cooldownUntil ?? 0) > now) return false;
  if ((h.requestsHour ?? 0) >= HOURLY_CAP) return false;
  if (h.lastUsedAt && now - h.lastUsedAt < MIN_GAP_MS) return false;
  return true;
}

function notCoolingOrDead(kind: SessionKind, id: string, now: number): boolean {
  const h = healthOf(kind, id);
  if (h.state === "dead") return false;
  if (h.state === "cooldown" && (h.cooldownUntil ?? 0) > now) return false;
  return true;
}

export function pickSession(kind: SessionKind, list: PoolEntry[], skip = new Set<string>(), now = Date.now()): PoolEntry | null {
  const enabled = list.filter((e) => e.enabled && !skip.has(e.id));
  const ready = enabled.filter((e) => isUsable(healthOf(kind, e.id), true, now));
  // Prefer a healthy session (even if it is inside the min-gap) over one in 429 cooldown.
  const pool = ready.length ? ready : enabled.filter((e) => notCoolingOrDead(kind, e.id, now));
  if (!pool.length) return null;
  pool.sort((a, b) => (healthOf(kind, a.id).lastUsedAt ?? 0) - (healthOf(kind, b.id).lastUsedAt ?? 0));
  return pool[0] ?? null;
}

export function publicStatus(kind: SessionKind, e: PoolEntry): {
  state: SessionHealthState | "ok";
  emoji: string;
  label: string;
  until?: number;
  lastSuccessAt?: number;
  lastError?: string;
  requestsToday: number;
  account?: string;
} {
  if (!e.enabled) return { state: "disabled", emoji: "⚪", label: "متوقفة", requestsToday: healthOf(kind, e.id).requestsToday ?? 0, account: healthOf(kind, e.id).account };
  const h = healthOf(kind, e.id);
  if (h.state === "dead") return { state: "dead", emoji: "🔴", label: "منتهية / checkpoint", lastSuccessAt: h.lastSuccessAt, lastError: h.lastError, requestsToday: h.requestsToday ?? 0, account: h.account };
  if (h.state === "cooldown" && (h.cooldownUntil ?? 0) > Date.now()) {
    return { state: "cooldown", emoji: "🟡", label: "محدودة مؤقتاً", until: h.cooldownUntil, lastSuccessAt: h.lastSuccessAt, lastError: h.lastError, requestsToday: h.requestsToday ?? 0, account: h.account };
  }
  if ((h.requestsHour ?? 0) >= HOURLY_CAP) {
    return { state: "cooldown", emoji: "🟡", label: "وصلت الحد الساعي", until: (h.hourStart ?? Date.now()) + 3_600_000, lastSuccessAt: h.lastSuccessAt, lastError: h.lastError, requestsToday: h.requestsToday ?? 0, account: h.account };
  }
  return { state: "ok", emoji: "🟢", label: h.lastSuccessAt ? "شغالة" : "جاهزة", lastSuccessAt: h.lastSuccessAt, lastError: h.lastError, requestsToday: h.requestsToday ?? 0, account: h.account };
}

export function formatUntil(ms: number | undefined): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

export function cookiesFromEntry(e: PoolEntry): IgCookies | null {
  return e.ig?.sessionid ? e.ig : null;
}

export { tag as sessionLogTag };
