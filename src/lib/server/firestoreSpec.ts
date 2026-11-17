/** How local collections map onto Firestore documents (pure, unit-tested). */
import { normEmail, safeDocId, type CollName, type MirrorSpec } from "./mirror";

const strip = (o: unknown) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>;

export const FIRESTORE_SPEC: MirrorSpec = {
  remote: { users: "users", watchlist: "watchlist", payments: "payments", usage: "usage", searches: "app" },
  keepRemovals: ["usage"],
  docs(coll: CollName, rows: unknown[]) {
    const r = rows as Record<string, any>[];
    switch (coll) {
      // One account per email: the user document is keyed by the normalized email.
      case "users":
        return r.filter((u) => u?.email).map((u) => ({ coll: "users", id: safeDocId(normEmail(u.email)), data: strip(u) }));
      case "watchlist":
      case "payments":
        return r.filter((x) => x?.id).map((x) => ({ coll, id: safeDocId(x.id), data: strip(x) }));
      case "usage":
        return r.filter((x) => x?.key).map((x) => ({ coll: "usage", id: safeDocId(x.key), data: { ...strip(x), day: String(x.key).slice(-10) } }));
      case "searches":
        return [{ coll: "app", id: "searches", data: { items: strip(r.slice(-2500)) } }];
    }
  },
};

