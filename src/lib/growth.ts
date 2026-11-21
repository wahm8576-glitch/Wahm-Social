/** A public-account metrics sample captured while its owner checks the watchlist. */
export interface GrowthPoint {
  at: number;
  followers: number;
  likes?: number;
  postsCount?: number;
}

const isFiniteNonNegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * Keep one observation per UTC day, replacing that day's point with the latest check.
 * History is intentionally bounded so watchlist records remain small and durable.
 */
export function appendDailyGrowth(history: readonly GrowthPoint[] | undefined, point: GrowthPoint, maxPoints = 90): GrowthPoint[] {
  const clean = (history ?? []).filter(
    (p) => Number.isFinite(p.at) && p.at > 0 && isFiniteNonNegative(p.followers),
  );
  if (!Number.isFinite(point.at) || point.at <= 0 || !isFiniteNonNegative(point.followers)) {
    return [...clean].sort((a, b) => a.at - b.at).slice(-Math.max(1, Math.floor(maxPoints)));
  }

  const normalized: GrowthPoint = {
    at: point.at,
    followers: point.followers,
    ...(isFiniteNonNegative(point.likes) ? { likes: point.likes } : {}),
    ...(isFiniteNonNegative(point.postsCount) ? { postsCount: point.postsCount } : {}),
  };
  const points = [...clean].sort((a, b) => a.at - b.at);
  const sameDay = points.findIndex((p) => utcDay(p.at) === utcDay(normalized.at));
  if (sameDay >= 0) points[sameDay] = normalized;
  else points.push(normalized);

  return points.sort((a, b) => a.at - b.at).slice(-Math.max(1, Math.floor(maxPoints)));
}
