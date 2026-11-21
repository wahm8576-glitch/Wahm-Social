"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Platform } from "@/lib/platforms/types";
import { compact, timeAgo } from "@/lib/format";
import type { GrowthPoint } from "@/lib/growth";
import { useI18n } from "../I18nProvider";
import { Avatar, EmptyState, PlatformIcon } from "../ui";
import { GrowthHistory } from "./GrowthHistory";

interface Row {
  id: string;
  platform: Platform;
  username: string;
  lastFollowers?: number;
  lastCheckedAt?: number;
  growth?: GrowthPoint[];
  current: null | { followers: number; avatarUrl: string; displayName: string; delta: number; demo: boolean };
}

export function WatchlistView() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ platform: "tiktok" as Platform, username: "" });

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    const r = await fetch(`/api/watchlist${refresh ? "?refresh=1" : "?refresh=1"}`);
    const j = await r.json();
    setBusy(false);
    if (j.ok) {
      setRows(j.data.items);
      setLimit(j.data.limit);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
    setRows((r) => r?.filter((x) => x.id !== id) ?? null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!add.username.trim()) return;
    await fetch("/api/watchlist", { method: "POST", body: JSON.stringify(add) });
    setAdd({ ...add, username: "" });
    load(true);
  }

  return (
    <div>
      <form onSubmit={submit} className="card mb-6 flex flex-wrap gap-2 p-4">
        <select className="input w-36" value={add.platform} onChange={(e) => setAdd({ ...add, platform: e.target.value as Platform })}>
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
        </select>
        <input className="input flex-1" dir="ltr" placeholder="@username" value={add.username} onChange={(e) => setAdd({ ...add, username: e.target.value })} />
        <button className="btn-primary">+ {t.compare.add}</button>
        <button type="button" className="btn-ghost" onClick={() => load(true)} disabled={busy}>
          ↻ {t.watchlist.refresh}
        </button>
        <span className="self-center text-xs text-ink-4" dir="ltr">
          {rows?.length ?? 0}/{limit}
        </span>
      </form>
      <p className="mb-4 text-xs text-ink-4">{t.watchlist.samplingNote}</p>
      {rows === null ? (
        <div className="skeleton h-40" />
      ) : rows.length === 0 ? (
        <EmptyState icon="★" title={t.watchlist.empty} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center gap-4">
                <Avatar src={r.current?.avatarUrl} alt={r.username} size={56} />
                <div className="min-w-0 flex-1">
                  <Link href={`/${r.platform}/${r.username}`} className="flex items-center gap-1 font-bold text-ink hover:text-accent-300" dir="ltr">
                    <PlatformIcon platform={r.platform} className="h-3.5 w-3.5" />@{r.username}
                  </Link>
                  <div className="text-sm text-ink-2">
                    {compact(r.current?.followers ?? r.lastFollowers, locale)} {t.profile.followers}
                    {r.current && r.current.delta !== 0 && (
                      <span className={r.current.delta > 0 ? "ms-2 text-emerald-400" : "ms-2 text-rose-400"} dir="ltr">
                        {r.current.delta > 0 ? "+" : ""}
                        {compact(r.current.delta, "en")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-4">
                    {t.watchlist.lastCheck}: {timeAgo(r.lastCheckedAt, locale)}
                  </div>
                </div>
                <button className="btn-ghost btn-sm" onClick={() => remove(r.id)}>
                  {t.watchlist.remove}
                </button>
              </div>
              <GrowthHistory history={r.growth ?? []} demo={r.current?.demo ?? false} t={t} locale={locale} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
