import { test } from "node:test";
import assert from "node:assert/strict";
import { Mirror, mergeRows, safeDocId, type RemoteOp } from "../src/lib/server/mirror";
import { FIRESTORE_SPEC } from "../src/lib/server/firestoreSpec";

function fake() {
  const docs = new Map<string, Record<string, unknown>>();
  const commits: RemoteOp[][] = [];
  return {
    docs,
    commits,
    backend: {
      load: async () => ({}),
      commit: async (ops: RemoteOp[]) => {
        commits.push(ops);
        for (const o of ops) o.data ? docs.set(`${o.coll}/${o.id}`, o.data) : docs.delete(`${o.coll}/${o.id}`);
      },
    },
  };
}

test("users are keyed by normalized email (one account per email)", () => {
  const d = FIRESTORE_SPEC.docs("users", [{ id: "u_1", email: "  Sara@Example.COM ", name: "Sara" }]);
  assert.equal(d[0].coll, "users");
  assert.equal(d[0].id, "sara@example.com");
});

test("mirror writes only changes and mirrors removals", async () => {
  const f = fake();
  const m = new Mirror(f.backend, FIRESTORE_SPEC);
  const state: any = { users: [{ id: "u_1", email: "a@x.com", plan: "free" }], watchlist: [{ id: "w_1", userId: "u_1" }], payments: [] };
  assert.equal(await m.flush(state, ["users", "watchlist", "payments"]), 2);
  assert.equal(await m.flush(state, ["users", "watchlist", "payments"]), 0, "no-op when unchanged");
  state.users[0].plan = "pro";
  state.watchlist = [];
  assert.equal(await m.flush(state, ["users", "watchlist", "payments"]), 2);
  assert.equal((f.docs.get("users/a@x.com") as any).plan, "pro");
  assert.equal(f.docs.has("watchlist/w_1"), false);
});

test("usage removals are not mirrored; undefined fields are dropped; batches cap at 400", async () => {
  const f = fake();
  const m = new Mirror(f.backend, FIRESTORE_SPEC);
  const usage = Array.from({ length: 900 }, (_, i) => ({ key: `ip${i}:2026-11-17`, lookups: 1, downloads: 0 }));
  await m.flush({ usage } as any, ["usage"]);
  assert.equal(f.commits.length, 3);
  assert.equal((f.docs.get("usage/ip0:2026-11-17") as any).day, "2026-11-17");
  await m.flush({ usage: [] } as any, ["usage"]);
  assert.equal(f.docs.size, 900);
  await m.flush({ users: [{ id: "u", email: "b@x.com", apiKey: undefined }] } as any, ["users"]);
  assert.ok(!("apiKey" in (f.docs.get("users/b@x.com") as any)));
});

test("primeFrom avoids rewriting loaded docs; mergeRows lets later rows win", async () => {
  const f = fake();
  const m = new Mirror(f.backend, FIRESTORE_SPEC);
  const remote = { users: [{ id: "u_1", email: "a@x.com", plan: "pro" }] };
  m.primeFrom(remote as any);
  assert.equal(await m.flush(remote as any, ["users"]), 0);
  const merged = mergeRows([{ k: "1", v: "remote" }], [{ k: "1", v: "local" }, { k: "2", v: "new" }], (r) => r.k);
  assert.deepEqual(merged.map((r) => r.v), ["local", "new"]);
  assert.equal(safeDocId("a/b"), "a∕b");
});
