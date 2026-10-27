// A tiny inline trend line — no Chart.js/canvas overhead needed for
// something this small. Renders a smooth SVG polyline scaled to fit,
// with a soft fill underneath and a dot on the last point.
export default function Sparkline({ data = [], color = 'var(--gold-21)', height = 32, width = 100 }) {
  if (!data.length || data.every(v => v === 0)) {
    return <div style={{ height, display: 'flex', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--cream-faint)' }}>—</span>
    </div>;
  }

  const max = Math.max(...data, 0.0001);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y];
  });

  const linePath = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const fillPath = `${linePath} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <path d={fillPath} fill={color} opacity="0.12" />
      <path
        d={linePath} fill="none" stroke={color} strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round"
        pathLength="1" className="sparkline-draw-path"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} className="sparkline-draw-dot" />
    </svg>
  );
}
