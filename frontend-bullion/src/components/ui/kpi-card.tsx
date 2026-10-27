import React, { useEffect, useRef, useState } from "react";

/**
 * KPI tile built on the InfoCard mechanics (21st.dev "info-card"):
 *  - a conic-gradient border whose bright arc follows the mouse,
 *  - a soft checker pattern behind the content,
 *  - a label chip that fills from the centre on hover,
 * plus a count-up on mount and a staggered entrance. Colours come from the app tokens.
 */
export interface KpiCardProps {
  icon: string; // remixicon class, e.g. "ri-stack-line"
  label: string;
  value: number | string;
  /** formats the animated number (default: integers as-is, decimals with one digit) */
  format?: (n: number) => string;
  hint?: string;
  /** accent colour for the border arc and the hover fill */
  color?: string;
  /** turns the value red (e.g. overdue > 0) */
  alert?: boolean;
  /** keeps the icon rotating (for "in progress" style KPIs) */
  spin?: boolean;
  index?: number;
  /** optional node shown before the number (e.g. a currency glyph) */
  prefix?: React.ReactNode;
  /** optional node under the number (e.g. a sparkline) */
  footer?: React.ReactNode;
}

function useCountUp(target: number | null, ms = 900) {
  const [v, setV] = useState(0);
  // Always animate from whatever is currently shown to the new target. The original restarted from 0
  // every time the target changed, so when the dashboard's data lands in several steps the number
  // flashed back to 0 and re-counted each time (looked like shaking, worst in Arabic).
  const shown = useRef(0);
  useEffect(() => {
    if (target == null) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target === 0) { shown.current = target; setV(target); return; }
    const from = shown.current;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const cur = from + (target - from) * (1 - Math.pow(1 - p, 3));
      shown.current = cur;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, format, hint, color = "#714B67", alert, spin, index = 0, prefix, footer }) => {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const num = typeof value === "number" ? value : null;
  const live = useCountUp(num);
  const fmt = format ?? ((n: number) => (Number.isInteger(num ?? 0) ? String(Math.round(n)) : n.toFixed(1)));
  // whole-number targets count in whole numbers (no flickering decimals mid-count)
  const shown = num == null ? String(value) : fmt(Number.isInteger(num) ? Math.round(live) : live);
  // The final text is laid out invisibly underneath so the box keeps its finished width while the
  // number counts up — otherwise the width grows every frame and the hint beside it jumps between lines.
  const finalShown = num == null ? String(value) : fmt(num);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const angle = Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
    el.style.setProperty("--rotation", `${angle}rad`);
  };

  const border = `conic-gradient(from var(--rotation,0deg), ${color} 0deg, ${color} 90deg, var(--line) 90deg, var(--line) 360deg)`;
  const pattern =
    "linear-gradient(45deg, rgba(120,110,120,0.06) 25%, transparent 25%, transparent 75%, rgba(120,110,120,0.04) 75%)," +
    "linear-gradient(-45deg, rgba(120,110,120,0.04) 25%, transparent 25%, transparent 75%, rgba(120,110,120,0.06) 75%)";

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onMouseMove={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        ref.current?.style.setProperty("--rotation", "0deg");
      }}
      className="kpi-in"
      style={{
        animationDelay: `${index * 70}ms`,
        border: "2px solid transparent",
        borderRadius: 16,
        backgroundOrigin: "border-box",
        backgroundClip: "padding-box, border-box",
        backgroundImage: `linear-gradient(var(--surface), var(--surface)), ${border}`,
        boxShadow: hovered ? "0 8px 22px rgba(0,0,0,.10)" : "var(--shadow-sm)",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "box-shadow .3s, transform .3s",
        cursor: "default",
        userSelect: "none",
      } as React.CSSProperties}
    >
      <div
        style={{
          borderRadius: 14,
          backgroundImage: pattern,
          backgroundSize: "20.84px 20.84px",
          padding: "12px 14px 14px",
          minHeight: 104,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 8, alignSelf: "flex-start", maxWidth: "100%" }}>
          <span
            className="kpi-chip"
            style={{
              position: "relative",
              zIndex: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              fontSize: 12,
              fontWeight: 700,
              color: hovered ? "#fff" : "var(--ink-600)",
              transition: "color .3s ease",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <i className={icon + (spin ? " tab-spin" : "")} style={{ color: hovered ? "#fff" : color, transition: "color .3s ease", fontSize: 15 }} />
            {label}
          </span>
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              backgroundColor: color,
              clipPath: hovered ? "polygon(0 0, 100% 0, 100% 100%, 0 100%)" : "polygon(0 50%, 100% 50%, 100% 50%, 0 50%)",
              transition: "clip-path .4s cubic-bezier(.1,.5,.5,1)",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "2px 8px", flexWrap: "wrap" }}>
          <div
            style={{
              font: "800 30px ui-monospace, Menlo, monospace",
              color: alert ? "var(--red)" : `color-mix(in srgb, ${color} 80%, var(--heading-text))`,
              lineHeight: 1.1,
              direction: "ltr",
              whiteSpace: "nowrap",
            }}
          >
            {prefix ? <span style={{ marginInlineEnd: 4 }}>{prefix}</span> : null}<span style={{ display: "inline-grid" }}><span aria-hidden style={{ gridArea: "1 / 1", visibility: "hidden" }}>{finalShown}</span><span style={{ gridArea: "1 / 1", textAlign: "left" }}>{shown}</span></span>
          </div>
          {hint ? <div style={{ fontSize: 11, color: "var(--ink-400)", textAlign: "end" }}>{hint}</div> : null}
        </div>
        {footer ? <div>{footer}</div> : null}
      </div>
    </div>
  );
};
