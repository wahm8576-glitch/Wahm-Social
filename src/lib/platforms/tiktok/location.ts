import "server-only";
/**
 * Account location for a public TikTok profile, from its own public videos:
 * each video page carries `locationCreated` (country it was posted from) and an
 * optional tagged place. We sample up to `sample` recent videos (ids from the
 * profile SSR item list + the public embed), then majority-vote.
 */
import type { Post, ProfileLocation } from "../types";
import { summarizeLocation } from "./location-summary";
import { mapLimit } from "../../server/concurrency";
import { fetchEmbed, fetchVideoPage } from "./adapter";

export interface LocationDiag {
  ids: number;
  fetched: number;
  withCountry: number;
  errors: number;
}
let lastDiag: LocationDiag | null = null;
export const locationDiag = () => lastDiag;

export async function accountLocation(
  username: string,
  language?: string,
  sample = 12,
  extraIds: string[] = [],
  deadlineMs = 14_000,
  /** Posts we already have (profile SSR itemList, cached posts tab) — counted without refetching. */
  seed: Post[] = [],
  /** Receives every post as soon as it is read, so a caller hitting its own timeout keeps partial results. */
  onPost?: (p: Post) => void,
): Promise<ProfileLocation | undefined> {
  const started = Date.now();
  const have = new Map<string, Post>();
  for (const p of seed) if (p?.id && p.location?.country) have.set(p.id, p);
  have.forEach((p) => onPost?.(p));
  // Enough countries already known from the seed → no extra requests needed.
  if (have.size >= Math.min(sample, 6)) {
    const got = [...have.values()];
    lastDiag = { ids: got.length, fetched: got.length, withCountry: got.length, errors: 0 };
    return summarizeLocation(got, language);
  }
  const { posts } = await fetchEmbed(username).catch(() => ({ posts: [] as Post[] }));
  const ids = [...new Set([...extraIds, ...posts.map((p) => p.id)].filter((id) => /^\d{18,21}$/.test(id) && !have.has(id)))]
    // Newest first (ids encode creation time).
    .sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1))
    .slice(0, Math.max(0, sample - have.size));
  let errors = 0;
  const detailed = await mapLimit(ids, 4, async (id) => {
    if (Date.now() - started > deadlineMs) return null;
    try {
      const post = (await fetchVideoPage(username, id)).post;
      onPost?.(post);
      return post;
    } catch {
      errors++;
      return null;
    }
  });
  const got = [...have.values(), ...detailed.filter((p): p is Post => !!p)];
  lastDiag = { ids: ids.length + have.size, fetched: got.length, withCountry: got.filter((p) => p.location?.country).length, errors };
  return summarizeLocation(got, language);
}
