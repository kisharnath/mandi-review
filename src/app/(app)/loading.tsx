/** Shown at once when a link is clicked, while the next page is fetched from the database. */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-2 h-7 w-56 rounded bg-zinc-200" />
      <div className="mb-8 h-4 w-96 max-w-full rounded bg-zinc-100" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card h-20 p-4">
            <div className="mb-3 h-3 w-24 rounded bg-zinc-100" />
            <div className="h-5 w-16 rounded bg-zinc-200" />
          </div>
        ))}
      </div>
      <div className="card p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="mb-3 h-4 rounded bg-zinc-100 last:mb-0" style={{ width: `${90 - (i % 3) * 15}%` }} />
        ))}
      </div>
    </div>
  );
}
