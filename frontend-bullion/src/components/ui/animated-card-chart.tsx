"use client";

import * as React from "react";
import { useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Animated card + column chart (21st.dev "animated-card-chart").
 * Same look as the original; the columns are driven by real data and every column shows its
 * label + value on hover. Fully responsive: everything is drawn in a 356×180 viewBox.
 */

// --- Card Components ---

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function AnimatedCard({ className, ...props }: CardProps) {
  return (
    <div
      role="region"
      className={cn(
        "group/animated-card relative w-full max-w-[356px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm",
        className
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: CardProps) {
  return (
    <div
      role="group"
      className={cn(
        "flex flex-col space-y-1.5 border-t border-[var(--line)] p-4",
        className
      )}
      {...props}
    />
  );
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export function CardTitle({ className, ...props }: CardTitleProps) {
  return (
    <h3
      className={cn(
        "text-lg font-semibold leading-none tracking-tight text-[var(--heading-text)]",
        className
      )}
      {...props}
    />
  );
}

interface CardDescriptionProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <p className={cn("text-sm text-[var(--ink-600)]", className)} {...props} />
  );
}

export function CardVisual({ className, ...props }: CardProps) {
  return (
    <div
      className={cn("aspect-[356/180] w-full overflow-hidden", className)}
      {...props}
    />
  );
}

// --- Visual3: column chart ---

export interface ChartDatum {
  label: string;
  value: number;
}

interface Visual3Props {
  data: ChartDatum[];
  mainColor?: string;
  secondaryColor?: string;
  gridColor?: string;
  /** legend chips, top-left: [bars ≥ average, bars < average] */
  legend?: [string, string];
  /** text shown at the top while hovering (replaced by the column's value when a column is active) */
  caption?: { title: string; subtitle?: string };
  /** appended to the value in the tooltip, e.g. "requests" */
  unit?: string;
}

const W = 356;
const H = 180;
const CX = W / 2;
const CY = H / 2;
const SCALE = 1.5; // the original zooms the bars 1.5× while the card is hovered
const BASE = 150; // bars grow up from here (hover state)
const MAX_H = 90;
const IDLE_BOTTOM = [130, 110, 110, 110, 140, 160, 110, 110, 130, 110, 140, 160, 130, 110];

export function Visual3({
  data,
  mainColor = "#8b5cf6",
  secondaryColor = "#fbbf24",
  gridColor = "#80808015",
  legend,
  caption,
  unit,
}: Visual3Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  const n = Math.max(1, data.length);
  const max = Math.max(1, ...data.map((d) => d.value));
  const avg = data.length ? data.reduce((a, d) => a + d.value, 0) / data.length : 0;
  const pitch = Math.min(36, 280 / n);
  const barW = pitch * 0.75;
  const x0 = (W - (n * pitch - (pitch - barW))) / 2;

  const bars = useMemo(
    () =>
      data.map((d, i) => {
        const hh = Math.max(6, (d.value / max) * MAX_H);
        const ih = 14 + 26 * (d.value / max);
        const high = d.value >= avg && d.value > 0;
        return {
          x: x0 + i * pitch,
          hoverH: hh,
          hoverY: BASE - hh,
          idleH: ih,
          idleY: IDLE_BOTTOM[i % IDLE_BOTTOM.length] - ih,
          high,
        };
      }),
    [data, max, avg, pitch, x0]
  );

  const pick = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    const sx = hovered ? CX + (fx - CX) / SCALE : fx; // undo the zoom
    const i = Math.round((sx - x0 - barW / 2) / pitch);
    setActive(i >= 0 && i < data.length && Math.abs(sx - (x0 + i * pitch + barW / 2)) <= pitch * 0.85 ? i : null);
  };

  const a = active != null ? bars[active] : null;
  const pillLeft = a ? CX + (a.x + barW / 2 - CX) * SCALE : 0;
  const pillTop = a ? CY + (a.hoverY - CY) * SCALE : 0;
  const summary = data.map((d) => `${d.label}: ${d.value}`).join(", ");

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden rounded-t-lg" dir="ltr" role="img" aria-label={summary}>
      <div
        className="absolute inset-0 z-20 touch-pan-y"
        onPointerEnter={(e) => { setHovered(true); pick(e); }}
        onPointerMove={pick}
        onPointerLeave={() => { setHovered(false); setActive(null); }}
      />

      <Layer4 bars={bars} color={mainColor} secondaryColor={secondaryColor} hovered={hovered} active={active} barW={barW} />
      <Layer3 color={mainColor} />
      <Layer2 color={mainColor} caption={caption} hidden={active != null} />
      <Layer1 color={mainColor} secondaryColor={secondaryColor} legend={legend} />
      <EllipseGradient color={mainColor} />
      <GridLayer color={gridColor} />

      {a && active != null && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full transition-[left,top] duration-150 ease-out"
          style={{
            left: `${Math.min(84, Math.max(16, (pillLeft / W) * 100))}%`,
            top: `${Math.max(14, (pillTop / H) * 100)}%`,
            marginTop: -6,
          }}
        >
          <div className="whitespace-nowrap rounded-md border border-[var(--line)] bg-[var(--surface)]/90 px-2 py-1 shadow-md backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.high ? mainColor : secondaryColor }} />
              <span dir="auto" className="text-[10px] leading-none text-[var(--ink-600)]">{data[active].label}</span>
            </div>
            <div className="mt-0.5 text-sm font-bold leading-none tabular-nums text-[var(--heading-text)]">
              {data[active].value}
              {unit ? <span className="ms-1.5 text-[10px] font-medium text-[var(--ink-600)]" dir="auto">{unit}</span> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Bar {
  x: number;
  hoverH: number;
  hoverY: number;
  idleH: number;
  idleY: number;
  high: boolean;
}

const GridLayer: React.FC<{ color: string }> = ({ color }) => {
  return (
    <div
      style={{ "--grid-color": color } as React.CSSProperties}
      className="pointer-events-none absolute inset-0 z-[4] h-full w-full bg-transparent bg-[linear-gradient(to_right,var(--grid-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-color)_1px,transparent_1px)] bg-[size:20px_20px] bg-center opacity-70 [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_60%,transparent_100%)]"
    />
  );
};

const EllipseGradient: React.FC<{ color: string }> = ({ color }) => {
  const id = React.useId();
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex h-full w-full items-center justify-center">
      <svg className="h-full w-full" viewBox="0 0 356 180" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="356" height="180" fill={`url(#${id})`} />
        <defs>
          <radialGradient
            id={id}
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(178 98) rotate(90) scale(98 178)"
          >
            <stop stopColor={color} stopOpacity="0.25" />
            <stop offset="0.34" stopColor={color} stopOpacity="0.15" />
            <stop offset="1" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
};

const Layer1: React.FC<{ color: string; secondaryColor: string; legend?: [string, string] }> = ({
  color,
  secondaryColor,
  legend,
}) => {
  if (!legend) return null;
  const items: [string, string][] = [
    [color, legend[0]],
    [secondaryColor, legend[1]],
  ];
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-[8] flex items-center gap-1">
      {items.map(([c, text], i) => (
        <div
          key={i}
          className="flex shrink-0 items-center rounded-full border border-[var(--line)] bg-white/25 px-1.5 py-0.5 backdrop-blur-sm transition-opacity duration-300 ease-in-out group-hover/animated-card:opacity-0"
        >
          <div className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
          <span dir="auto" className="ml-1 text-[10px] text-[var(--heading-text)]">{text}</span>
        </div>
      ))}
    </div>
  );
};

const Layer2: React.FC<{ color: string; caption?: { title: string; subtitle?: string }; hidden: boolean }> = ({
  color,
  caption,
  hidden,
}) => {
  if (!caption) return null;
  return (
    <div className="pointer-events-none relative h-full w-full">
      <div
        className={cn(
          "absolute inset-0 z-[7] flex w-full translate-y-full items-start justify-center bg-transparent p-4 transition-transform duration-500 group-hover/animated-card:translate-y-0",
          hidden && "opacity-0"
        )}
      >
        <div className="rounded-md border border-[var(--line)] bg-white/25 p-1.5 opacity-0 backdrop-blur-sm transition-opacity duration-500 group-hover/animated-card:opacity-100">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
            <p dir="auto" className="text-xs text-[var(--heading-text)]">{caption.title}</p>
          </div>
          {caption.subtitle ? <p dir="auto" className="text-xs text-[var(--ink-600)]">{caption.subtitle}</p> : null}
        </div>
      </div>
    </div>
  );
};

const Layer3: React.FC<{ color: string }> = ({ color }) => {
  const id = React.useId();
  return (
    <div className="pointer-events-none absolute inset-0 z-[6] flex translate-y-full items-center justify-center opacity-0 transition-all duration-500 group-hover/animated-card:translate-y-0 group-hover/animated-card:opacity-100">
      <svg className="h-full w-full" viewBox="0 0 356 180" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="356" height="180" fill={`url(#${id})`} />
        <defs>
          <linearGradient id={id} x1="178" y1="0" x2="178" y2="180" gradientUnits="userSpaceOnUse">
            <stop offset="0.35" stopColor={color} stopOpacity="0" />
            <stop offset="1" stopColor={color} stopOpacity="0.3" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

const Layer4: React.FC<{
  bars: Bar[];
  color: string;
  secondaryColor: string;
  hovered: boolean;
  active: number | null;
  barW: number;
}> = ({ bars, color, secondaryColor, hovered, active, barW }) => {
  return (
    <div className="pointer-events-none absolute inset-0 z-[8] flex h-full w-full items-center justify-center text-neutral-800/10 transition-transform duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] group-hover/animated-card:scale-150 dark:text-white/15">
      <svg className="h-full w-full" viewBox="0 0 356 180" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        {bars.map((b, i) => (
          <rect
            key={i}
            width={barW}
            height={hovered ? b.hoverH : b.idleH}
            x={b.x}
            y={hovered ? b.hoverY : b.idleY}
            fill={hovered ? (b.high ? color : secondaryColor) : b.high ? color : "currentColor"}
            fillOpacity={hovered && active != null && active !== i ? 0.45 : 1}
            rx="2"
            ry="2"
            className="transition-all duration-500 ease-[cubic-bezier(0.6,0.6,0,1)]"
            style={{ transitionDelay: hovered && active == null ? `${i * 14}ms` : "0ms" }}
          />
        ))}
      </svg>
    </div>
  );
};
