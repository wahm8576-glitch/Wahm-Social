import "server-only";
/** Admin probe: run every source for one account from this server, each on its own, and time it. */
import { tiktokSources } from "../platforms/tiktok/sources";
import { instagramSources } from "../platforms/instagram/adapter";
import type { Platform, Profile } from "../platforms/types";
import { recordFail, recordOk } from "./health";
import { NotFoundHere } from "./run";

export interface ProbeRow {
  id: string;
  ok: boolean;
  ms: number;
  summary?: string;
  error?: string;
}

const fmt = (p: Profile) => `@${p.username} · ${p.displayName} · followers ${p.followers.toLocaleString("en")} · following ${p.following.toLocaleString("en")}${p.preview ? " (rounded)" : ""}`;

export async function probeSources(platform: Platform, username: string): Promise<ProbeRow[]> {
  const list =
    platform === "tiktok"
      ? tiktokSources(username).map((s) => ({ ...s, run: async () => (await s.run())?.profile ?? null }))
      : instagramSources(username);
  return Promise.all(
    list.map(async (s): Promise<ProbeRow> => {
      const t = Date.now();
      try {
        const v = await Promise.race([s.run(), new Promise<"timeout">((r) => setTimeout(() => r("timeout"), s.timeoutMs))]);
        const ms = Date.now() - t;
        if (v === "timeout") {
          recordFail(s.id, ms, "timeout");
          return { id: s.id, ok: false, ms, error: "timeout" };
        }
        if (!v) {
          recordFail(s.id, ms, "empty");
          return { id: s.id, ok: false, ms, error: "empty" };
        }
        recordOk(s.id, ms);
        return { id: s.id, ok: true, ms, summary: fmt(v) };
      } catch (e) {
        const ms = Date.now() - t;
        const msg = e instanceof NotFoundHere ? "not_found" : String((e as Error)?.message ?? e).slice(0, 160);
        recordFail(s.id, ms, msg, e instanceof NotFoundHere);
        return { id: s.id, ok: false, ms, error: msg };
      }
    }),
  );
}
