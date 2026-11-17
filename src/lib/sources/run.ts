/**
 * Run data sources in priority order with per-source timeouts, circuit breakers and a stagger:
 * source N+1 starts when N fails OR after `staggerMs` (whichever first), so a slow source never
 * holds the page. The first acceptable result wins (ties broken by priority when results land together).
 */
import { circuitOpen, recordFail, recordOk, recordServed } from "./health";

export interface Source<T> {
  id: string;
  timeoutMs: number;
  run: () => Promise<T | null>;
}

export class SourceMiss extends Error {
  constructor(public tried: string[], public notFound: boolean) {
    super("all sources failed");
  }
}

/** Throw this from a source to say "this account does not exist" (soft failure, no breaker). */
export class NotFoundHere extends Error {}

export async function runSources<T>(key: string, sources: Source<T>[], opts: { staggerMs?: number; totalMs?: number } = {}): Promise<{ value: T; source: string }> {
  const t0 = Date.now();
  const stagger = opts.staggerMs ?? 3500;
  const total = opts.totalMs ?? 20_000;
  const tried: string[] = [];
  const active = sources.filter((s) => {
    if (circuitOpen(s.id)) {
      tried.push(`${s.id}:skip`);
      return false;
    }
    return true;
  });
  let notFound = 0;
  return new Promise((resolve, reject) => {
    let done = false;
    let started = 0;
    let finished = 0;
    let timer: NodeJS.Timeout | null = null;
    const deadline = setTimeout(() => finish(), total);
    const finish = (win?: { value: T; source: string }) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      if (timer) clearTimeout(timer);
      recordServed({ at: Date.now(), key, source: win?.source ?? "none", ms: Date.now() - t0, tried: tried.slice() });
      if (win) resolve(win);
      else reject(new SourceMiss(tried, notFound > 0 && notFound === finished));
    };
    const startNext = () => {
      if (done || started >= active.length) return;
      const s = active[started++];
      if (timer) clearTimeout(timer);
      timer = setTimeout(startNext, stagger);
      const st = Date.now();
      const to = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), s.timeoutMs));
      Promise.race([s.run(), to])
        .then((v) => {
          const ms = Date.now() - st;
          if (v === "timeout") {
            recordFail(s.id, ms, "timeout");
            tried.push(`${s.id}:timeout`);
          } else if (v) {
            recordOk(s.id, ms);
            tried.push(`${s.id}:ok`);
            finish({ value: v as T, source: s.id });
            return;
          } else {
            recordFail(s.id, ms, "empty");
            tried.push(`${s.id}:empty`);
          }
          after();
        })
        .catch((e) => {
          const ms = Date.now() - st;
          const nf = e instanceof NotFoundHere;
          if (nf) notFound++;
          recordFail(s.id, ms, nf ? "not_found" : String((e as Error)?.message ?? e), nf);
          tried.push(`${s.id}:${nf ? "not_found" : "fail"}`);
          after();
        });
    };
    const after = () => {
      finished++;
      if (done) return;
      if (finished >= active.length) return finish();
      if (started < active.length) startNext();
    };
    if (!active.length) return finish();
    startNext();
  });
}
