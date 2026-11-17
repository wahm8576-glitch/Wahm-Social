/**
 * Write-through mirror of the in-memory document store to a remote backend (Firestore).
 * The app keeps its fast synchronous in-memory API; this class diffs records against what was
 * last written and sends only changed / removed documents, in batches.
 * Pure logic (no Firebase import) so it can be unit-tested with a fake backend.
 */
export type CollName = "users" | "watchlist" | "usage" | "searches" | "payments";

export interface RemoteOp {
  coll: string;
  id: string;
  data?: Record<string, unknown>; // undefined → delete
}

export interface RemoteBackend {
  load(): Promise<Partial<Record<CollName, unknown[]>>>;
  commit(ops: RemoteOp[]): Promise<void>;
}

export interface MirrorSpec {
  /** Remote collection used by each local collection (removals are detected within it). */
  remote: Record<CollName, string>;
  /** Firestore collection name and document id for each record. */
  docs(coll: CollName, rows: unknown[]): { coll: string; id: string; data: Record<string, unknown> }[];
  /** Collections whose removals are not mirrored (e.g. trimmed usage counters). */
  keepRemovals?: CollName[];
}

/** Firestore document ids cannot contain "/" and must not be "." or "..". */
export const safeDocId = (s: string) => {
  const v = s.replace(/\//g, "∕").slice(0, 1400);
  return v === "." || v === ".." || !v ? `_${v}` : v;
};
export const normEmail = (e: string) => e.trim().toLowerCase();

export class Mirror {
  private sent = new Map<string, string>();
  constructor(private backend: RemoteBackend, private spec: MirrorSpec) {}

  /** Remember the loaded state as already persisted. */
  primeFrom(data: Partial<Record<CollName, unknown[]>>) {
    for (const [coll, rows] of Object.entries(data) as [CollName, unknown[]][]) {
      for (const d of this.spec.docs(coll, rows ?? [])) this.sent.set(`${d.coll}/${d.id}`, JSON.stringify(d.data));
    }
  }

  /** Diff `colls` of the current state against what was sent and commit the changes. */
  async flush(state: Partial<Record<CollName, unknown[]>>, colls: CollName[]): Promise<number> {
    const ops: RemoteOp[] = [];
    const next = new Map<string, string>();
    for (const coll of colls) {
      for (const d of this.spec.docs(coll, state[coll] ?? [])) {
        const k = `${d.coll}/${d.id}`;
        const json = JSON.stringify(d.data);
        next.set(k, json);
        if (this.sent.get(k) !== json) ops.push({ coll: d.coll, id: d.id, data: d.data });
      }
      if (this.spec.keepRemovals?.includes(coll)) continue;
      const remoteColl = this.spec.remote[coll];
      for (const k of this.sent.keys()) {
        const [c, ...rest] = k.split("/");
        if (c === remoteColl && !next.has(k)) ops.push({ coll: c, id: rest.join("/") });
      }
    }
    if (!ops.length) return 0;
    for (let i = 0; i < ops.length; i += 400) await this.backend.commit(ops.slice(i, i + 400));
    for (const op of ops) {
      const k = `${op.coll}/${op.id}`;
      if (op.data) this.sent.set(k, next.get(k) ?? JSON.stringify(op.data));
      else this.sent.delete(k);
    }
    return ops.length;
  }
}

/** Union by id; `local` wins (records created before the remote load finished). */
export function mergeRows<T>(remote: T[], local: T[], idOf: (r: T) => string): T[] {
  const map = new Map<string, T>();
  for (const r of remote) map.set(idOf(r), r);
  for (const r of local) map.set(idOf(r), r);
  return [...map.values()];
}
