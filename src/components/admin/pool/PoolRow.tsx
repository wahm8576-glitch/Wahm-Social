import type { PoolEntry, PoolKind } from "@/lib/pools/types";
import { describeEntry } from "@/lib/pools/mask";
import type { TestResult } from "@/lib/pools/test";
import { formatUntil, publicStatus, type SessionKind } from "@/lib/pools/runtime";
import { timeAgo } from "@/lib/format";

function Btn({ action, op, id, label, title, danger }: { action: string; op: string; id: string; label: string; title?: string; danger?: boolean }) {
  return (
    <form method="post" action={action} className="shrink-0">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={id} />
      <button title={title ?? label} className={`btn-ghost btn-sm ${danger ? "!text-red-500" : ""}`}>
        {label}
      </button>
    </form>
  );
}

function untilLabel(ms?: number) {
  if (!ms) return "";
  return formatUntil(ms);
}

/** One entry: order number, label, masked value, last test, and its own small forms. */
export function PoolRow({ kind, e, i, n, action, active, test }: { kind: PoolKind; e: PoolEntry; i: number; n: number; action: string; active: boolean; test?: TestResult }) {
  const sessionKind = kind === "instagram" || kind === "tiktok" ? (kind as SessionKind) : null;
  const st = sessionKind ? publicStatus(sessionKind, e) : null;
  return (
    <li className={`overflow-hidden rounded-2xl border p-3 ${e.enabled ? "border-line bg-surface/50" : "border-dashed border-line bg-surface/20 opacity-70"}`}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-500/15 text-xs text-accent-600 dark:text-accent-200">{i + 1}</span>
            {e.label || "بدون اسم"}
            {st && (
              <span className="chip !py-0.5 text-[11px]">
                {st.emoji}{" "}
                {st.state === "cooldown" && st.until
                  ? `محدودة حتى ${untilLabel(st.until)} (الرياض)`
                  : st.label}
              </span>
            )}
            {active && e.enabled && !st && <span className="chip !py-0.5 text-[11px]">⚡ النشط الحين</span>}
            {active && e.enabled && st?.state === "ok" && <span className="chip !py-0.5 text-[11px]">⚡ تُستخدم الآن</span>}
            {!e.enabled && !st && <span className="chip !py-0.5 text-[11px]">⏸ متوقف</span>}
          </p>
          <p className="break-all text-xs text-ink-3" dir="ltr">
            {describeEntry(kind, e)}
          </p>
          {st && (
            <p className="text-xs text-ink-3">
              {st.account ? <>الحساب: @{st.account} · </> : null}
              طلبات اليوم: {st.requestsToday}
              {st.lastSuccessAt ? <> · آخر نجاح: {timeAgo(st.lastSuccessAt, "ar")}</> : null}
              {st.lastError ? <> · آخر خطأ: <span dir="ltr">{st.lastError}</span></> : null}
            </p>
          )}
          {test && (
            <p className={`text-xs ${test.ok ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
              آخر اختبار ({timeAgo(Date.parse(test.at), "ar")}): <span dir="ltr" className="break-all">{test.summary}</span>
            </p>
          )}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-1">
          <Btn action={action} op="test" id={e.id} label="🧪 اختبار الآن" />
          <Btn action={action} op="toggle" id={e.id} label={e.enabled ? "⏸ إيقاف" : "▶️ تشغيل"} />
          {i > 0 && <Btn action={action} op="up" id={e.id} label="⬆" title="لفوق" />}
          {i < n - 1 && <Btn action={action} op="down" id={e.id} label="⬇" title="لتحت" />}
          {i > 0 && <Btn action={action} op="top" id={e.id} label="⏫ أساسي" title="خلّه الأول" />}
          <Btn action={action} op="delete" id={e.id} label="🗑 حذف" danger />
        </div>
      </div>
      <form method="post" action={action} className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
        <input type="hidden" name="op" value="label" />
        <input type="hidden" name="id" value={e.id} />
        <input name="label" defaultValue={e.label} placeholder="اسم مختصر" className="min-w-0 w-full rounded-xl border border-line bg-surface/70 px-3 py-1.5 text-xs text-ink outline-none focus:border-accent-400" />
        <button className="btn-ghost btn-sm shrink-0">حفظ الاسم</button>
      </form>
    </li>
  );
}

