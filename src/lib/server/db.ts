import "server-only";
/**
 * Tiny JSON-file document store. Good for an MVP on a single instance;
 * the Repository interfaces make it straightforward to move to Postgres.
 *
 * Persistence: when a Firebase service account is configured, every change is mirrored to
 * Firestore (write-through, see mirror.ts / firestoreStore.ts) and the store is loaded from
 * Firestore at boot — Render's disk is ephemeral. Without Firebase, the local JSON file is used.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../env";
import type { Platform } from "../platforms/types";
import { appendDailyGrowth, type GrowthPoint } from "../growth";
import type { PlanId } from "../plans";
import { applyRedeemToState, type ActivationBatch, type ActivationCode } from "../billing/codes";
import { Mirror, mergeRows, normEmail, type CollName, type MirrorSpec, type RemoteBackend } from "./mirror";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: PlanId;
  planRenewsAt?: number;
  role: "user" | "admin";
  /** Set from the Firebase ID token on each login (Google accounts are verified by Google). */
  emailVerified?: boolean;
  createdAt: number;
  lastLoginAt?: number;
  apiKey?: string;
  paypalSubscriptionId?: string;
  paypalPayerId?: string;
  telegramUserId?: number;
}

export interface WatchItem {
  id: string;
  userId: string;
  platform: Platform;
  username: string;
  addedAt: number;
  lastFollowers?: number;
  lastCheckedAt?: number;
  growth?: GrowthPoint[];
}

export interface UsageRecord {
  key: string; // `${userIdOrIp}:${yyyy-mm-dd}`
  lookups: number;
  downloads: number;
}

export interface SearchLog {
  platform: Platform;
  username: string;
  at: number;
}

export interface Payment {
  id: string;
  userId: string;
  plan: PlanId;
  interval: "month" | "year" | "custom";
  amount: number;
  currency: string;
  provider: "mock" | "stripe" | "paypal" | "admin" | "telegram_stars" | "code";
  batchLabel?: string;
  status: "paid" | "pending" | "failed" | "refunded";
  createdAt: number;
  eventId?: string;
  providerRef?: string;
  telegramUserId?: number;
}

export interface BillingEvent {
  id: string;
  type: string;
  processedAt: number;
}

interface Schema {
  users: User[];
  watchlist: WatchItem[];
  usage: UsageRecord[];
  searches: SearchLog[];
  payments: Payment[];
  billingEvents: BillingEvent[];
  activationBatches: ActivationBatch[];
  activationCodes: ActivationCode[];
}

const empty = (): Schema => ({ users: [], watchlist: [], usage: [], searches: [], payments: [], billingEvents: [], activationBatches: [], activationCodes: [] });

class JsonStore {
  private data: Schema;
  private file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    const dir = path.resolve(env.dataDir);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    this.file = path.join(dir, "wahm-db.json");
    this.data = empty();
    try {
      if (fs.existsSync(this.file)) this.data = { ...empty(), ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    } catch (e) {
      console.error("[db] failed to load store, starting fresh", e);
    }
  }

  get<K extends keyof Schema>(k: K): Schema[K] {
    return this.data[k];
  }

  mutate<R>(fn: (d: Schema) => R): R {
    const r = fn(this.data);
    this.flush();
    this.scheduleRemote();
    return r;
  }

  /* ---------- Remote (Firestore) mirror ---------- */
  private mirror: Mirror | null = null;
  private remoteReady = false;
  private remoteTimer: NodeJS.Timeout | null = null;
  private lastLowFlush = 0;
  private flushing: Promise<unknown> = Promise.resolve();
  remoteState: "off" | "loading" | "ready" | "error" = "off";
  remoteError = "";

  /** Load from the remote backend (retrying until it works), merge, then mirror every change. */
  async attachRemote(backend: RemoteBackend, spec: MirrorSpec, retryMs = 20_000): Promise<void> {
    if (this.mirror) return;
    this.mirror = new Mirror(backend, spec);
    this.remoteState = "loading";
    for (;;) {
      try {
        const remote = await backend.load();
        const idOf: Record<CollName, (r: any) => string> = {
          users: (u) => normEmail(String(u.email ?? u.id)),
          watchlist: (w) => String(w.id),
          payments: (p) => String(p.id),
          billingEvents: (e) => String(e.id),
          usage: (u) => String(u.key),
          searches: (x) => `${x.platform}:${x.username}:${x.at}`,
          activationBatches: (b) => String(b.id),
          activationCodes: (c) => String(c.hash || c.id),
        };
        for (const k of Object.keys(idOf) as CollName[]) {
          const rem = (remote[k] ?? []) as any[];
          // Remote wins for records it has; records only in memory (created before the load finished) are kept.
          const remoteIds = new Set(rem.map(idOf[k]));
          const localOnly = (this.data[k] as any[]).filter((r) => !remoteIds.has(idOf[k](r)));
          (this.data as any)[k] = mergeRows(rem, localOnly, idOf[k]);
        }
        this.data.searches.sort((a, b) => a.at - b.at);
        this.mirror.primeFrom(remote);
        this.remoteReady = true;
        this.remoteState = "ready";
        this.remoteError = "";
        this.flush();
        await this.flushRemote(true);
        console.log(`[db] firestore ready: ${this.data.users.length} users, ${this.data.watchlist.length} watchlist, ${this.data.payments.length} payments`);
        return;
      } catch (e) {
        this.remoteState = "error";
        this.remoteError = String((e as Error)?.message ?? e).slice(0, 160);
        console.error("[db] firestore load failed, retrying:", this.remoteError);
        await new Promise((r) => setTimeout(r, retryMs));
      }
    }
  }

  private scheduleRemote() {
    if (!this.remoteReady || this.remoteTimer) return;
    this.remoteTimer = setTimeout(() => {
      this.remoteTimer = null;
      void this.flushRemote(false);
    }, 1200);
    this.remoteTimer.unref?.();
  }

  /** Users / watchlist / payments right away; usage counters and search log at most once a minute (free-tier write quota). */
  flushRemote(all: boolean): Promise<unknown> {
    if (!this.mirror || !this.remoteReady) return Promise.resolve();
    const low = all || Date.now() - this.lastLowFlush > 60_000;
    const colls: CollName[] = low ? ["users", "watchlist", "payments", "billingEvents", "activationBatches", "activationCodes", "usage", "searches"] : ["users", "watchlist", "payments", "billingEvents", "activationBatches", "activationCodes"];
    if (low) this.lastLowFlush = Date.now();
    this.flushing = this.flushing
      .then(() => this.mirror!.flush(this.data as any, colls))
      .catch((e) => {
        this.remoteError = String((e as Error)?.message ?? e).slice(0, 160);
        console.error("[db] firestore write failed:", this.remoteError);
        setTimeout(() => this.scheduleRemote(), 10_000).unref?.();
      });
    return this.flushing;
  }

  private flush() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(this.data));
        fs.renameSync(tmp, this.file);
      } catch (e) {
        console.error("[db] write failed", e);
      }
    }, 250);
  }
}

const g = globalThis as unknown as { __wahmDb?: JsonStore };
export const db = (g.__wahmDb ??= new JsonStore());

/** Boot: mirror to Firestore when a service account is configured (waits up to `waitMs` for the first load). */
export async function initRemoteStore(waitMs = 15_000): Promise<void> {
  const { firestoreConfigured, firestoreBackend, FIRESTORE_SPEC } = await import("./firestoreStore");
  if (!firestoreConfigured()) return;
  const p = db.attachRemote(firestoreBackend, FIRESTORE_SPEC);
  await Promise.race([p, new Promise((r) => setTimeout(r, waitMs))]);
  const gg = globalThis as unknown as { __wahmDbSigterm?: boolean };
  if (!gg.__wahmDbSigterm) {
    gg.__wahmDbSigterm = true;
    process.once("SIGTERM", () => {
      void db.flushRemote(true).finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 8000).unref?.();
    });
  }
}

export const newId = (prefix = "") => prefix + crypto.randomBytes(9).toString("base64url");

/* ---------------- Repositories ---------------- */

export const Users = {
  byEmail: (email: string) => db.get("users").find((u) => u.email === email.toLowerCase()),
  byId: (id: string) => db.get("users").find((u) => u.id === id),
  byApiKey: (key: string) => db.get("users").find((u) => u.apiKey === key),
  all: () => db.get("users"),
  create(u: Omit<User, "id" | "createdAt">): User {
    const user: User = { ...u, email: u.email.toLowerCase(), id: newId("u_"), createdAt: Date.now() };
    db.mutate((d) => d.users.push(user));
    return user;
  },
  update(id: string, patch: Partial<User>): User | undefined {
    return db.mutate((d) => {
      const u = d.users.find((x) => x.id === id);
      if (u) Object.assign(u, patch);
      return u;
    });
  },
};

export const Watchlist = {
  forUser: (userId: string) => db.get("watchlist").filter((w) => w.userId === userId),
  add(userId: string, platform: Platform, username: string): WatchItem {
    const existing = db.get("watchlist").find((w) => w.userId === userId && w.platform === platform && w.username === username);
    if (existing) return existing;
    const item: WatchItem = { id: newId("w_"), userId, platform, username, addedAt: Date.now() };
    db.mutate((d) => d.watchlist.push(item));
    return item;
  },
  remove(userId: string, id: string) {
    db.mutate((d) => {
      d.watchlist = d.watchlist.filter((w) => !(w.userId === userId && w.id === id));
    });
  },
  recordSnapshot(id: string, metrics: Omit<GrowthPoint, "at"> & { at?: number }) {
    db.mutate((d) => {
      const w = d.watchlist.find((x) => x.id === id);
      if (!w) return;
      const at = metrics.at ?? Date.now();
      const point: GrowthPoint = {
        at,
        followers: metrics.followers,
        ...(typeof metrics.likes === "number" ? { likes: metrics.likes } : {}),
        ...(typeof metrics.postsCount === "number" ? { postsCount: metrics.postsCount } : {}),
      };
      w.growth = appendDailyGrowth(w.growth, point);
      w.lastFollowers = metrics.followers;
      w.lastCheckedAt = at;
    });
  },
};

const today = () => new Date().toISOString().slice(0, 10);

export const Usage = {
  get(subject: string): UsageRecord {
    const key = `${subject}:${today()}`;
    return db.get("usage").find((u) => u.key === key) ?? { key, lookups: 0, downloads: 0 };
  },
  inc(subject: string, field: "lookups" | "downloads") {
    const key = `${subject}:${today()}`;
    db.mutate((d) => {
      let r = d.usage.find((u) => u.key === key);
      if (!r) {
        r = { key, lookups: 0, downloads: 0 };
        d.usage.push(r);
      }
      r[field]++;
      if (d.usage.length > 20000) d.usage = d.usage.slice(-10000);
    });
  },
};

export const Searches = {
  log(platform: Platform, username: string) {
    db.mutate((d) => {
      d.searches.push({ platform, username, at: Date.now() });
      if (d.searches.length > 5000) d.searches = d.searches.slice(-2500);
    });
  },
  trending(limit = 12): { platform: Platform; username: string; count: number }[] {
    const since = Date.now() - 7 * 864e5;
    const counts = new Map<string, number>();
    for (const s of db.get("searches")) if (s.at > since) counts.set(`${s.platform}:${s.username}`, (counts.get(`${s.platform}:${s.username}`) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k, count]) => {
        const [platform, username] = k.split(":") as [Platform, string];
        return { platform, username, count };
      });
  },
  recent: (limit = 20) => db.get("searches").slice(-limit).reverse(),
  total: () => db.get("searches").length,
};

export const Payments = {
  create(p: Omit<Payment, "id" | "createdAt">): Payment {
    const pay: Payment = { ...p, id: newId("pay_"), createdAt: Date.now() };
    db.mutate((d) => d.payments.push(pay));
    return pay;
  },
  forUser: (userId: string) => db.get("payments").filter((p) => p.userId === userId),
  byId: (id: string) => db.get("payments").find((p) => p.id === id),
  all: () => db.get("payments"),
  updateStatus(id: string, status: Payment["status"]) {
    return db.mutate((d) => {
      const p = d.payments.find((x) => x.id === id);
      if (p) p.status = status;
      return p;
    });
  },
};

export const BillingEvents = {
  has: (id: string) => db.get("billingEvents").some((e) => e.id === id),
  add(id: string, type: string) {
    if (!id || BillingEvents.has(id)) return;
    db.mutate((d) => {
      d.billingEvents.push({ id, type, processedAt: Date.now() });
      if (d.billingEvents.length > 8000) d.billingEvents = d.billingEvents.slice(-5000);
    });
  },
};

export const ActivationBatches = {
  all: () => db.get("activationBatches"),
  byId: (id: string) => db.get("activationBatches").find((b) => b.id === id),
  add(batch: ActivationBatch) {
    db.mutate((d) => d.activationBatches.unshift(batch));
    return batch;
  },
  update(id: string, patch: Partial<ActivationBatch>) {
    return db.mutate((d) => {
      const b = d.activationBatches.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
      return b;
    });
  },
};

export const ActivationCodes = {
  all: () => db.get("activationCodes"),
  byHash: (hash: string) => db.get("activationCodes").find((c) => c.hash === hash),
  byId: (id: string) => db.get("activationCodes").find((c) => c.id === id),
  forBatch: (batchId: string) => db.get("activationCodes").filter((c) => c.batchId === batchId),
  byLast4: (last4: string) => {
    const q = last4.trim().toUpperCase();
    return db.get("activationCodes").filter((c) => c.last4 === q);
  },
  byEmail: (email: string) => {
    const q = email.trim().toLowerCase();
    return db.get("activationCodes").filter((c) => c.redemptions.some((r) => r.email === q));
  },
  addMany(codes: ActivationCode[]) {
    db.mutate((d) => {
      d.activationCodes.push(...codes);
    });
  },
  update(hash: string, patch: Partial<ActivationCode>) {
    return db.mutate((d) => {
      const c = d.activationCodes.find((x) => x.hash === hash);
      if (c) Object.assign(c, patch);
      return c;
    });
  },
  disableBatch(batchId: string) {
    db.mutate((d) => {
      const b = d.activationBatches.find((x) => x.id === batchId);
      if (b) b.disabled = true;
      for (const c of d.activationCodes) if (c.batchId === batchId) c.disabled = true;
    });
  },
};

/** In-memory atomic redeem (used when Firestore is not configured, and as the local apply after a transaction). */
export function redeemCodeInMemory(opts: {
  hash: string;
  user: { id: string; email: string; plan: import("../plans").PlanId; planRenewsAt?: number };
  now?: number;
}): { ok: true; code: ActivationCode; plan: import("../plans").PlanId; planRenewsAt: number; payment: Payment } | { ok: false; reason: "invalid" | "used" | "expired" | "disabled" | "already" } {
  const now = opts.now ?? Date.now();
  return db.mutate((d) => {
    const out = applyRedeemToState(
      { codes: d.activationCodes, batches: d.activationBatches, users: d.users, payments: d.payments as any },
      { hash: opts.hash, user: opts.user, now, paymentId: newId("pay_") },
    );
    if (!out.ok) return { ok: false as const, reason: out.reason };
    return { ok: true as const, code: out.code, plan: out.plan, planRenewsAt: out.planRenewsAt, payment: out.payment as Payment };
  });
}
