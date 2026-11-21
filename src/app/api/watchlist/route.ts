import { z } from "zod";
import { getProfile } from "@/lib/platforms";
import { PlatformError } from "@/lib/platforms/types";
import { requireFeature } from "@/lib/server/auth";
import { Watchlist } from "@/lib/server/db";
import { handler, ok } from "@/lib/server/respond";
import { planOf } from "@/lib/plans";
import { isValidUsername, normalizeUsername } from "@/lib/format";
import { mapLimit } from "@/lib/server/concurrency";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const user = await requireFeature("watchlist");
  const items = Watchlist.forUser(user.id);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const rows = await mapLimit(items, 3, async (w) => {
    if (!refresh && w.lastCheckedAt) return { ...w, current: null as null | object };
    try {
      const p = await getProfile(w.platform, w.username);
      const prev = w.lastFollowers;
      if (p.source !== "demo" && !p.data.isPrivate) Watchlist.recordSnapshot(w.id, {
        followers: p.data.followers,
        ...(typeof p.data.likes === "number" ? { likes: p.data.likes } : {}),
        postsCount: p.data.postsCount,
      });
      const latest = Watchlist.forUser(user.id).find((item) => item.id === w.id) ?? w;
      return { ...latest, current: { followers: p.data.followers, avatarUrl: p.data.avatarUrl, displayName: p.data.displayName, delta: typeof prev === "number" ? p.data.followers - prev : 0, demo: p.source === "demo" } };
    } catch {
      return { ...w, current: null };
    }
  });
  return ok({ items: rows, limit: planOf(user.plan).watchlistSize });
});

const Add = z.object({ platform: z.enum(["tiktok", "instagram"]), username: z.string() });

export const POST = handler(async (req: Request) => {
  const user = await requireFeature("watchlist");
  const body = Add.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw new PlatformError("invalid_input", "Invalid account", 400);
  const username = normalizeUsername(body.data.username);
  if (!isValidUsername(username)) throw new PlatformError("invalid_input", "Invalid username", 400);
  if (Watchlist.forUser(user.id).length >= planOf(user.plan).watchlistSize) {
    throw new PlatformError("pro_required", "Watchlist is full for your plan", 402);
  }
  return ok(Watchlist.add(user.id, body.data.platform, username));
});

export const DELETE = handler(async (req: Request) => {
  const user = await requireFeature("watchlist");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new PlatformError("invalid_input", "Missing id", 400);
  Watchlist.remove(user.id, id);
  return ok({ removed: id });
});
