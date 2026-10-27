// Animated placeholder blocks shown while a page's data is still loading —
// replaces the old plain "Loading…" text with a shimmering preview of the
// layout that's about to appear, matching the pattern used by Facebook/
// LinkedIn/most modern dashboards. Purely presentational, no props required
// beyond an optional "rows"/"variant" to roughly match what's being loaded.

function Bar({ width = '100%', height = 14, style = {} }) {
  return <div className="skeleton-bar" style={{ width, height, ...style }} />;
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div className="cards-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="card" key={i}>
          <Bar width="60%" height={11} style={{ marginBottom: 14 }} />
          <Bar width="80%" height={26} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ height = 240 }) {
  return (
    <div className="panel">
      <Bar width="35%" height={16} style={{ marginBottom: 18 }} />
      <div className="skeleton-bar" style={{ width: '100%', height, borderRadius: 10 }} />
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 6 }) {
  return (
    <div className="panel">
      <Bar width="25%" height={16} style={{ marginBottom: 18 }} />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Bar key={c} width={c === 0 ? '14%' : `${100 / cols}%`} height={13} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function SkeletonPage() {
  return (
    <section className="view active">
      <div style={{ marginBottom: 28 }}>
        <Bar width={220} height={30} style={{ marginBottom: 8 }} />
        <Bar width={320} height={13} />
      </div>
      <SkeletonCards />
      <div style={{ height: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <SkeletonPanel />
        <SkeletonPanel />
      </div>
    </section>
  );
}
