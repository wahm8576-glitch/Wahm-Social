/**
 * In-memory LRU cache with TTL and in-flight request de-duplication.
 * Designed to be swapped for Redis (see CacheStore interface) without touching callers.
 */
export interface CacheStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  delete(key: string): void;
  clear(): void;
  stats(): { size: number; hits: number; misses: number };
}

interface Entry {
  value: unknown;
  expires: number;
}

class MemoryLRU implements CacheStore {
  private map = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;
  constructor(private max = 2000) {}

  get<T>(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (e.expires < Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.value as T;
  }

  /** Return a value even if expired (stale-if-error). */
  peekStale<T>(key: string): T | undefined {
    return this.map.get(key)?.value as T | undefined;
  }

  set<T>(key: string, value: T, ttlMs: number) {
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
  }

  delete(key: string) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  stats() {
    return { size: this.map.size, hits: this.hits, misses: this.misses };
  }
}

const g = globalThis as unknown as { __wahmCache?: MemoryLRU; __wahmInflight?: Map<string, Promise<unknown>> };
export const cache = (g.__wahmCache ??= new MemoryLRU());
const inflight = (g.__wahmInflight ??= new Map());

const tg = globalThis as unknown as { __frostlySite?: { settings?: { limits?: Record<string, number> } } };
/** Minutes from admin settings (snapshot on globalThis, avoids an import cycle), clamped. */
const mins = (k: string, def: number, min = 0.5, max = 1440) => {
  const v = Number(tg.__frostlySite?.settings?.limits?.[k]);
  return (Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, v)) : def) * 60_000;
};

export const TTL = {
  get profile() {
    return mins("profileCacheMin", 10);
  },
  get posts() {
    return mins("postsCacheMin", 10);
  },
  post: 30 * 60_000,
  get stories() {
    return mins("storiesCacheMin", 3);
  },
  stale: 24 * 60 * 60_000,
};

/**
 * Get from cache or compute. On failure, falls back to a stale value if one exists.
 * Returns [value, fromCache].
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<[T, boolean]> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) return [hit, true];
  if (inflight.has(key)) return [(await inflight.get(key)) as T, true];
  const p = (async () => {
    try {
      const v = await fn();
      cache.set(key, v, ttlMs);
      cache.set(`stale:${key}`, v, TTL.stale);
      return v;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  try {
    return [await p, false];
  } catch (e) {
    const stale = cache.get<T>(`stale:${key}`);
    if (stale !== undefined) return [stale, true];
    throw e;
  }
}

/**
 * Stale-while-revalidate: like cached(), but when a stale copy exists and the live call is slow,
 * answer with the stale copy after `waitMs` and let the live call finish in the background
 * (it refreshes the cache for the next view). Returns [value, fromCache, isStale].
 */
export async function cachedSwr<T>(key: string, ttlMs: number, fn: () => Promise<T>, waitMs = 6000): Promise<[T, boolean, boolean]> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) return [hit, true, false];
  const stale = cache.get<T>(`stale:${key}`);
  const live = cached(key, ttlMs, fn).then(([v, c]) => [v, c, false] as [T, boolean, boolean]);
  if (stale === undefined) return live;
  live.catch(() => undefined);
  const late = new Promise<[T, boolean, boolean] | null>((r) => setTimeout(() => r(null), waitMs));
  try {
    const first = await Promise.race([live, late]);
    return first ?? [stale, true, true];
  } catch {
    return [stale, true, true];
  }
}
