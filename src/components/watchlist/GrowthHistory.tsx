import type { GrowthPoint } from "@/lib/growth";
import type { Dict, Locale } from "@/lib/i18n";
import { interpolate } from "@/lib/i18n";
import { compact, date } from "@/lib/format";
import { LineChart } from "../analytics/Charts";

export function GrowthHistory({ history, demo, t, locale }: { history: GrowthPoint[]; demo: boolean; t: Dict; locale: Locale }) {
  const first = history[0];
  const latest = history[history.length - 1];

  if (!history.length) {
    return <p className="mt-4 border-t border-white/5 pt-3 text-xs text-ink-4">{demo ? t.watchlist.demoNotSaved : t.watchlist.noSnapshots}</p>;
  }

  if (history.length === 1) {
    return (
      <div className="mt-4 border-t border-white/5 pt-3 text-xs text-ink-4">
        <div className="mb-2 font-semibold text-ink-2">{t.watchlist.growth}</div>
        <p>{t.watchlist.waitingForHistory}</p>
        <p className="mt-1">{t.watchlist.firstSnapshot}: {date(first.at, locale)}</p>
      </div>
    );
  }

  const change = latest.followers - first.followers;
  const floor = Math.min(...history.map((p) => p.followers));
  const points = history.map((p) => ({ x: p.at, y: p.followers - floor + 1 }));

  return (
    <section className="mt-4 border-t border-white/5 pt-3" aria-label={t.watchlist.growth}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-2">{t.watchlist.growth}</h3>
        <span className="text-xs text-ink-4">{interpolate(t.watchlist.snapshotCount, { n: history.length })}</span>
      </div>
      <LineChart points={points} height={92} />
      <div className="flex justify-between text-[10px] text-ink-4" dir="ltr">
        <span>{date(first.at, locale)}</span>
        <span>{date(latest.at, locale)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-4">{t.watchlist.changeSinceFirst}</span>
        <strong className={change > 0 ? "text-emerald-400" : change < 0 ? "text-rose-400" : "text-ink-2"} dir="ltr">
          {change > 0 ? "+" : ""}{compact(change, locale)} {t.profile.followers}
        </strong>
      </div>
      {latest.likes !== undefined || latest.postsCount !== undefined ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-4">
          {latest.likes !== undefined && <span>{compact(latest.likes, locale)} {t.profile.likes}</span>}
          {latest.postsCount !== undefined && <span>{compact(latest.postsCount, locale)} {t.profile.posts}</span>}
        </div>
      ) : null}
    </section>
  );
}
