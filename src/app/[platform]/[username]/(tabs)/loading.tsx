/** Shown inside the profile while a tab (posts, followers, stories, analytics) loads. */
export default function TabLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-4 flex items-center gap-2 text-sm text-ink-3">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
        جاري التحميل… Loading…
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}
