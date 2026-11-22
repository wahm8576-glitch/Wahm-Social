import { getPostComments } from "@/lib/platforms";
import { burstGuard, parsePlatform } from "@/lib/server/guard";
import { handler, ok } from "@/lib/server/respond";
import { PlatformError } from "@/lib/platforms/types";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request, { params }: { params: { platform: string } }) => {
  burstGuard(req);
  const platform = parsePlatform(params.platform);
  const search = new URL(req.url).searchParams;
  const ref = search.get("ref")?.trim();
  if (!ref || ref.length > 2048) throw new PlatformError("invalid_input", "Missing or invalid ref", 400);
  const username = search.get("u")?.trim() || undefined;
  const result = await getPostComments(platform, ref, username);
  return ok(result.data, result.source);
});
