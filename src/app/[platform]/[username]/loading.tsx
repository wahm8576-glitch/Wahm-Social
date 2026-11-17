/** Shown while the profile (header + stats) is being fetched. */
export default function ProfileLoading() {
  return (
    <div className="container-w py-8" aria-busy="true" aria-live="polite">
      <div className="skeleton mb-6 h-12 w-full max-w-xl" />
      <section className="card p-6 sm:p-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <div className="skeleton h-32 w-32 rounded-full" />
          <div className="w-full flex-1 space-y-3">
            <div className="skeleton h-8 w-56" />
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-16 w-full max-w-lg" />
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-3">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
          جاري تحميل الحساب… Loading profile…
        </div>
      </section>
    </div>
  );
}
