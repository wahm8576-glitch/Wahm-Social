/** Admin panel pages that read settings / run checks. */
export default function PanelLoading() {
  return (
    <div className="mx-auto max-w-5xl p-6" dir="rtl" aria-busy="true">
      <div className="mb-4 flex items-center gap-2 text-sm text-ink-3">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
        جاري التحميل…
      </div>
      <div className="skeleton h-10 w-64" />
      <div className="skeleton mt-4 h-40 w-full" />
      <div className="skeleton mt-4 h-40 w-full" />
    </div>
  );
}
