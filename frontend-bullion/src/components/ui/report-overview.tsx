"use client";

import * as React from "react";

/* ------------------------------------------------------------------ */
/*  Report Overview — bento layout in the style of web3-bento.tsx,     */
/*  fed with Swag Bullion's own numbers (see pages/ReportOverview.jsx) */
/* ------------------------------------------------------------------ */

export interface OverviewShop {
  id: number;
  name: string;
  gold24eq: number;
  silver: number;
  chips: Array<[string, number]>;
  openSince?: string | null;
  overdue: boolean;
}

export interface OverviewActivity {
  id: string;
  kind: "sale" | "purchase" | "supplier" | "expense" | "cash" | "deposit";
  title: string;
  detail: string;
  amount: string;
  status: "active" | "canceled";
  time: string;
}

export interface OverviewProps {
  t: (key: string) => string;
  locale: string;
  account: string;
  /** Latest ledger day, YYYY-MM-DD */
  asOf: string;
  closeCash: number;
  /** closing cash minus closing cash 30 days earlier */
  cashChange: number;
  closeGold: number;
  closeSilver: number;
  /** Daily sales total, oldest → newest, one value per calendar day, ending on asOf (at least 14) */
  salesDaily: number[];
  /** Dates (YYYY-MM-DD) matching salesDaily */
  salesDates: string[];
  /** Entries per day for the last 30 days */
  entriesDaily: number[];
  /** Gold/silver sold in the last 30 days */
  sold: { w24: number; w21: number; w18: number; silver: number };
  /** Cash movements over the last 30 days */
  flow30: { salesCash: number; cashAdded: number; purchases: number; supplier: number; expenses: number };
  day: { closed: boolean; closedBy?: string | null; variance: number | null; closedDays30: number; activeDays30: number };
  shops: OverviewShop[];
  loans: { goldOut: number; silverOut: number; shopCount: number; overdueCount: number; lentDaily: number[] } | null;
  deposit: { balance: number; deposited: number; spent: number } | null;
  activity: OverviewActivity[];
  onOpenLoans?: () => void;
  onOpenDeposit?: () => void;
  accent?: string;
  accent2?: string;
  ink?: string;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function useReducedMotion() {
  const [r, setR] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const u = () => setR(mq.matches);
    u();
    mq.addEventListener("change", u);
    return () => mq.removeEventListener("change", u);
  }, []);
  return r;
}

function useMounted() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

function useCountUp(target: number, enabled: boolean, duration = 1300) {
  const [v, setV] = React.useState(enabled ? 0 : target);
  React.useEffect(() => {
    if (!enabled) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setV(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);
  return v;
}

function smooth(pts: ReadonlyArray<readonly [number, number]>) {
  return pts
    .map(([x, y], i) => {
      if (i === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      const [px, py] = pts[i - 1];
      const m = (px + x) / 2;
      return `C ${m.toFixed(1)} ${py.toFixed(1)}, ${m.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function shortDate(iso: string, locale: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/*  Tooltip: one smooth bubble per chart, follows the hovered/tapped   */
/*  bar or point and shows its exact figures                           */
/* ------------------------------------------------------------------ */

type TipState = { x: number; y: number; node: React.ReactNode; on: boolean };

function useTip(minTop = 58) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const [tip, setTip] = React.useState<TipState>({ x: 0, y: 0, node: null, on: false });
  const showAt = React.useCallback((x: number, y: number, node: React.ReactNode) => setTip({ x, y, node, on: true }), []);
  const showEl = React.useCallback((el: Element, node: React.ReactNode) => {
    const w = wrap.current;
    if (!w) return;
    const a = el.getBoundingClientRect();
    const b = w.getBoundingClientRect();
    setTip({ x: a.left - b.left + a.width / 2, y: a.top - b.top, node, on: true });
  }, []);
  const hide = React.useCallback(() => setTip((t) => ({ ...t, on: false })), []);
  const width = wrap.current?.clientWidth ?? 0;
  const left = width ? Math.min(Math.max(tip.x, 64), width - 64) : tip.x;
  const layer = (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 whitespace-nowrap rounded-xl border border-border bg-muted px-2.5 py-1.5 text-[11px] text-foreground shadow-lg"
      dir="ltr"
      style={{
        left,
        top: Math.max(tip.y, minTop),
        transform: `translate(-50%, calc(-100% - 8px)) scale(${tip.on ? 1 : 0.96})`,
        opacity: tip.on ? 1 : 0,
        transition: "left 160ms ease, top 160ms ease, opacity 140ms ease, transform 160ms ease",
      }}
    >
      {tip.node}
    </div>
  );
  return { wrap, showAt, showEl, hide, layer };
}

function Tip({ title, rows }: { title?: string; rows: Array<[string, string, string?]> }) {
  return (
    <div className="space-y-0.5">
      {title && <p className="font-mono text-[10px] text-muted-foreground">{title}</p>}
      {rows.map(([k, v, c]) => (
        <p key={k} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {c && <span className="size-1.5 rounded-full" style={{ background: c }} />}
            {k}
          </span>
          <span className="font-mono font-semibold tabular-nums">{v}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

function Tile({ title, action, className, children }: { title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cx("relative flex min-w-0 flex-col overflow-hidden rounded-[26px] border border-border bg-card p-5 text-card-foreground", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Pills<T extends string>({ value, options, onChange, label }: { value: T; options: T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} dir="ltr" className="inline-flex rounded-full border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cx(
            "rounded-full px-2.5 py-1 font-mono text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            o === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="flex flex-1 items-center justify-center py-6 text-center text-[12px] text-muted-foreground">{children}</p>;
}

/* ------------------------------------------------------------------ */
/*  Hero: closing cash + 30-day sales strip                            */
/* ------------------------------------------------------------------ */

function HeroTile({ p, fmt, reduced }: { p: OverviewProps; fmt: Fmt; reduced: boolean }) {
  const { t, accent, accent2 } = p as Required<Pick<OverviewProps, "t" | "accent" | "accent2">> & OverviewProps;
  const mounted = useMounted();
  const shown = useCountUp(p.closeCash, !reduced);
  const bars = p.salesDaily.slice(-30);
  const dates = p.salesDates.slice(-30);
  const max = Math.max(...bars, 1);
  const avg = bars.reduce((s, v) => s + v, 0) / (bars.length || 1);
  const [hover, setHover] = React.useState<number | null>(null);
  const tip = useTip();
  const up = p.cashChange >= 0;

  return (
    <Tile className="sm:col-span-2 lg:col-span-2 lg:col-start-1 lg:row-start-1">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[34px]">
            {t("ov.hello")} <span style={{ color: accent }}>{p.account}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("ov.heroSub")}</p>
        </div>
        <div className="text-end" dir="ltr">
          <p className="text-[12px] text-muted-foreground">{t("ov.closingCash")} · {t("ov.sar")}</p>
          <p className="font-mono text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[40px]">{fmt.money(shown)}</p>
          <p className="mt-1.5 font-mono text-[12px] tabular-nums">
            <span style={{ color: up ? accent : accent2 }}>
              {up ? "+" : "−"}
              {fmt.money(Math.abs(p.cashChange))}
            </span>
            <span className="text-muted-foreground"> · 30{t("ov.day")}</span>
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-1 flex-col" dir="ltr">
        <div ref={tip.wrap} className="relative flex flex-1 items-end gap-[3px]" style={{ minHeight: 64 }} onPointerLeave={() => { setHover(null); tip.hide(); }}>
          {bars.map((v, i) => {
            const h = 8 + (v / max) * 92;
            const above = v >= avg;
            return (
              <button
                key={i}
                type="button"
                onPointerEnter={(e) => { setHover(i); tip.showEl(e.currentTarget, <Tip title={shortDate(dates[i], p.locale)} rows={[[t("ov.dailySales"), fmt.money(v), above ? accent : accent2]]} />); }}
                onFocus={(e) => { setHover(i); tip.showEl(e.currentTarget, <Tip title={shortDate(dates[i], p.locale)} rows={[[t("ov.dailySales"), fmt.money(v), above ? accent : accent2]]} />); }}
                onBlur={() => { setHover(null); tip.hide(); }}
                aria-label={`${shortDate(dates[i], p.locale)}: ${fmt.money(v)}`}
                className="relative flex-1 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  height: mounted ? `${h}%` : "6%",
                  background: above ? accent : accent2,
                  opacity: hover === null ? 0.35 + (v / max) * 0.65 : hover === i ? 1 : 0.25,
                  transition: `height 900ms ${EASE} ${i * 18}ms, opacity 200ms ease`,
                }}
              />
            );
          })}
          {tip.layer}
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>{dates.length ? shortDate(dates[0], p.locale) : ""}</span>
          <span className="text-foreground" aria-live="polite">
            {hover !== null ? `${shortDate(dates[hover], p.locale)} · ${fmt.money(bars[hover])}` : t("ov.dailySales")}
          </span>
          <span>{t("ov.today")}</span>
        </div>
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Shops: fanned stack — shops that owe gold, click to bring forward  */
/* ------------------------------------------------------------------ */

const PALETTE = [
  { color: "oklch(0.82 0.11 55)", color2: "oklch(0.7 0.15 30)", ink: "oklch(0.25 0.05 40)" },
  { color: "oklch(0.8 0.1 300)", color2: "oklch(0.64 0.15 285)", ink: "oklch(0.2 0.06 290)" },
  { color: "oklch(0.89 0.2 128)", color2: "oklch(0.74 0.17 165)", ink: "oklch(0.22 0.06 140)" },
];

function ShopFace({ s, c, glare }: { s: OverviewShop; c: (typeof PALETTE)[number]; glare: number }) {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 overflow-hidden rounded-[12px]"
        style={{
          backgroundImage: [
            "linear-gradient(180deg, oklch(1 0 0 / 0.3) 0%, transparent 34%)",
            `radial-gradient(110% 90% at 100% 0%, ${c.color2} 0%, transparent 60%)`,
            `linear-gradient(135deg, ${c.color} 0%, ${c.color2} 100%)`,
          ].join(", "),
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.5), inset 0 0 0 1px oklch(1 0 0 / 0.16)",
        }}
      >
        <span
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(115deg, transparent 18%, oklch(0.9 0.12 350 / 0.55) 32%, oklch(0.92 0.1 220 / 0.55) 42%, oklch(0.94 0.14 130 / 0.5) 52%, oklch(0.92 0.12 60 / 0.45) 62%, transparent 78%)",
            backgroundSize: "260% 100%",
            backgroundPosition: `${glare}% 0`,
            mixBlendMode: "soft-light",
            transition: "background-position 700ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </span>
      <span className="relative flex items-center justify-between gap-3 px-4 pt-4">
        <span className="truncate text-[13px] font-bold tracking-tight">{s.name}</span>
        <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums" dir="ltr">{s.gold24eq.toFixed(2)} g</span>
      </span>
    </>
  );
}


function CashFlow({ p }: { p: OverviewProps }) {
  const { t, accent, accent2 } = p;
  const mounted = useMounted();
  const f = p.flow30;
  const rows = [
    { k: t("ov.salesCash"), v: f.salesCash, inc: true },
    { k: t("ov.cashAdded"), v: f.cashAdded, inc: true },
    { k: t("ov.purchasesCash"), v: f.purchases, inc: false },
    { k: t("ov.supplierPaid"), v: f.supplier, inc: false },
    { k: t("ov.expensesCash"), v: f.expenses, inc: false },
  ];
  const max = Math.max(...rows.map((r) => r.v), 1);
  const nf = new Intl.NumberFormat(p.locale, { maximumFractionDigits: 0 });
  const net = f.salesCash + f.cashAdded - f.purchases - f.supplier - f.expenses;
  return (
    <div className="flex flex-1 flex-col">
      <p className="font-mono text-[22px] font-semibold tabular-nums" dir="ltr" style={{ color: net >= 0 ? accent : accent2 }}>
        {net >= 0 ? "+" : "−"}{nf.format(Math.abs(net))}
      </p>
      <p className="font-mono text-[11px] text-muted-foreground">{t("ov.netCash")} · {t("ov.sar")} · {t("ov.last30")}</p>
      <ul className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <li key={r.k}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span>{r.k}</span>
              <span className="font-mono tabular-nums text-muted-foreground" dir="ltr">{r.inc ? "+" : "−"}{nf.format(r.v)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" dir="ltr">
              <div className="h-full rounded-full" style={{ width: mounted ? `${(r.v / max) * 100}%` : "0%", background: r.inc ? accent : accent2, transition: `width 900ms ${EASE} ${i * 70}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShopsTile({ p, reduced }: { p: OverviewProps; reduced: boolean }) {
  const { t } = p;
  const top = React.useMemo(() => [...p.shops].sort((a, b) => b.gold24eq - a.gold24eq).slice(0, 3).reverse(), [p.shops]);
  const key = top.map((s) => s.id).join(",");
  const [order, setOrder] = React.useState<number[]>(() => top.map((s) => s.id));
  React.useEffect(() => setOrder(top.map((s) => s.id)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const mounted = useMounted();
  const PEEK = 46;
  const depth = Math.max(0, order.length - 1);
  const front = top.find((s) => s.id === order[order.length - 1]);
  const [glare, setGlare] = React.useState(30);
  const dragGlare = React.useRef(false);
  React.useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setGlare((g) => (dragGlare.current ? g : 30 + Math.sin((now - t0) / 2600) * 30));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <Tile
      title={
        front ? (
          <span>
            {t("ov.shopsOwing")} <sup className="font-mono text-[10px]">{p.shops.length}</sup>
          </span>
        ) : (
          t("ov.cashFlow")
        )
      }
      className="lg:col-start-3 lg:row-start-1"
    >
      {!front ? (
        <CashFlow p={p} />
      ) : (
        <div
          className="relative -mx-5 -mb-5 flex flex-1 flex-col justify-end overflow-hidden pt-1"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            dragGlare.current = true;
            setGlare(((e.clientX - r.left) / r.width) * 100);
          }}
          onPointerLeave={() => {
            dragGlare.current = false;
          }}
        >
          <div className="relative">
            {order.map((id, pos) => {
              const s = top.find((x) => x.id === id)!;
              const c = PALETTE[top.indexOf(s) % PALETTE.length];
              const fromFront = order.length - 1 - pos;
              const isFront = fromFront === 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => !isFront && setOrder((o) => [...o.filter((x) => x !== id), id])}
                  aria-label={`${s.name}${isFront ? "" : ""}`}
                  aria-pressed={isFront}
                  className="group absolute left-1/2 block w-[calc(100%-32px)] max-w-[300px] rounded-[12px] p-0 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    top: (depth - fromFront) * PEEK,
                    zIndex: pos + 1,
                    transform: `translateX(-50%) scale(${1 - fromFront * 0.055}) translateY(${mounted ? 0 : 20}px)`,
                    transformOrigin: "top center",
                    opacity: mounted ? 1 : 0,
                    color: c.ink,
                    boxShadow: "0 -10px 28px -14px oklch(0 0 0 / 0.75)",
                    transition: reduced ? "none" : `top 650ms cubic-bezier(0.34, 1.35, 0.64, 1), transform 650ms cubic-bezier(0.34, 1.35, 0.64, 1), opacity 500ms ease ${pos * 90}ms`,
                    cursor: isFront ? "default" : "pointer",
                  }}
                >
                  <span className="relative block w-full" style={{ paddingTop: "63.08%" }}>
                    <span className="absolute inset-0 block">
                      <ShopFace s={s} c={c} glare={glare + fromFront * 18} />
                    </span>
                  </span>
                </button>
              );
            })}
            <div aria-hidden className="invisible mx-auto w-[calc(100%-32px)] max-w-[300px] shrink-0" style={{ marginTop: depth * PEEK }}>
              <div style={{ paddingTop: "30%" }} />
            </div>
          </div>

          <div
            className="relative z-10 flex shrink-0 items-end justify-between gap-3 px-5 pb-4"
            style={{
              height: 88,
              background: "color-mix(in oklch, var(--color-card) 72%, transparent)",
              backdropFilter: "blur(18px) saturate(1.3)",
              WebkitBackdropFilter: "blur(18px) saturate(1.3)",
              borderTop: "1px solid color-mix(in oklch, var(--color-foreground) 10%, transparent)",
            }}
            aria-live="polite"
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold">{front.name}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" dir="ltr">
                {front.chips.map(([k, w]) => `${k} ${w}g`).join(" · ") || "—"}
              </p>
              {front.overdue && <p className="text-[11px] font-semibold" style={{ color: p.accent2 }}>{t("ov.overdue")}</p>}
            </div>
            <p className="shrink-0 font-mono text-[15px] font-semibold tabular-nums" dir="ltr">{front.gold24eq.toFixed(2)} g</p>
          </div>
        </div>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Day status: gauge of closed days                                   */
/* ------------------------------------------------------------------ */

function DayTile({ p, fmt }: { p: OverviewProps; fmt: Fmt }) {
  const { t, accent, accent2 } = p;
  const { day } = p;
  const total = Math.max(day.activeDays30, 1);
  const tt = Math.min(1, day.closedDays30 / total);
  const R = 62;
  const len = Math.PI * R;
  const angle = -90 + tt * 180;
  const varOk = day.variance === null || Math.abs(day.variance) < 0.005;

  return (
    <Tile
      title={t("ov.dayStatus")}
      className="lg:col-start-4 lg:row-start-1"
      action={
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold"
          style={{ background: `color-mix(in oklch, ${day.closed ? accent : accent2} 18%, transparent)`, color: day.closed ? accent : accent2 }}
        >
          {day.closed ? t("ov.closed") : t("ov.open")}
        </span>
      }
    >
      <div className="flex flex-1 flex-col items-center justify-center" dir="ltr">
        <div className="relative" style={{ width: 150, height: 86 }}>
          <svg width="150" height="86" viewBox="0 0 150 86" aria-hidden>
            <path d="M 13 78 A 62 62 0 0 1 137 78" fill="none" strokeWidth="10" strokeLinecap="round" style={{ stroke: "var(--color-muted)" }} />
            <path d="M 13 78 A 62 62 0 0 1 137 78" fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={len} style={{ stroke: accent, strokeDashoffset: len * (1 - tt), transition: `stroke-dashoffset 900ms ${EASE}` }} />
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "75px 78px", transition: `transform 900ms ${EASE}` }}>
              <line x1="75" y1="78" x2="75" y2="30" strokeWidth="2.5" strokeLinecap="round" style={{ stroke: "var(--color-foreground)" }} />
            </g>
            <circle cx="75" cy="78" r="5" style={{ fill: "var(--color-foreground)" }} />
          </svg>
        </div>
        <p className="mt-2 font-mono text-[26px] font-semibold leading-none tabular-nums">
          {day.closedDays30}
          <span className="text-sm text-muted-foreground"> / {day.activeDays30}</span>
        </p>
        <p className="mt-1 text-center text-[11px] text-muted-foreground">{t("ov.daysClosed30")}</p>
      </div>
      <dl className="mt-4 space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("ov.variance")}</dt>
          <dd className="font-mono font-semibold tabular-nums" dir="ltr" style={{ color: day.variance === null ? undefined : varOk ? accent : accent2 }}>
            {day.variance === null ? "—" : `${day.variance > 0 ? "+" : ""}${fmt.money(day.variance)}`}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("ov.closedBy")}</dt>
          <dd className="truncate font-semibold">{day.closedBy || "—"}</dd>
        </div>
      </dl>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Sales chart: this period vs the one before (running total)         */
/* ------------------------------------------------------------------ */

type Range = "7D" | "30D" | "90D";

function ChartTile({ p, fmt, reduced }: { p: OverviewProps; fmt: Fmt; reduced: boolean }) {
  const { t, accent } = p;
  const uid = React.useId().replace(/:/g, "");
  const [range, setRange] = React.useState<Range>("30D");
  const [hover, setHover] = React.useState<number | null>(null);
  const tip = useTip();
  const mounted = useMounted();
  const days = { "7D": 7, "30D": 30, "90D": 90 }[range];
  const avail = Math.floor(p.salesDaily.length / 2);
  const n = Math.max(2, Math.min(days, avail));
  const cum = (arr: number[]) => arr.reduce<number[]>((o, v) => (o.push((o[o.length - 1] || 0) + v), o), []);
  const cur = p.salesDaily.slice(-n);
  const prev = p.salesDaily.slice(-2 * n, -n);
  const a = cum(cur);
  const b = cum(prev.length === n ? prev : [...Array(n - prev.length).fill(0), ...prev]);
  const dates = p.salesDates.slice(-n);
  const W = 640;
  const H = 220;
  const lo = 0;
  const hi = Math.max(...a, ...b, 1);
  const y = (v: number) => H - 16 - ((v - lo) / (hi - lo || 1)) * (H - 40);
  const pa = a.map((v, i) => [(i / (a.length - 1)) * W, y(v)] as const);
  const pb = b.map((v, i) => [(i / (b.length - 1)) * W, y(v)] as const);
  const la = smooth(pa);
  const lb = smooth(pb);
  const idx = hover ?? a.length - 1;
  const totalA = a[a.length - 1];
  const totalB = b[b.length - 1];
  const lead = totalB > 0 ? (totalA / totalB - 1) * 100 : null;
  const left = `${(pa[idx][0] / W) * 100}%`;
  const labels = [0, 0.25, 0.5, 0.75, 1].map((f) => dates[Math.round(f * (dates.length - 1))]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(a.length - 1, Math.round(((e.clientX - r.left) / r.width) * (a.length - 1))));
    setHover(i);
    tip.showAt((pa[i][0] / W) * r.width, (pa[i][1] / H) * r.height, <Tip title={shortDate(dates[i], p.locale)} rows={[[t("ov.thisPeriod"), fmt.money(a[i]), accent], [t("ov.prevPeriod"), fmt.money(b[i]), "var(--color-muted-foreground)"]]} />);
  };

  return (
    <Tile
      title={t("ov.salesVsPrev")}
      className="sm:col-span-2 lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-2"
      action={<Pills label="Chart range" value={range} options={["7D", "30D", "90D"]} onChange={setRange} />}
    >
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="h-[3px] w-4 rounded-full" style={{ background: accent }} aria-hidden />
            {t("ov.thisPeriod")}
          </p>
          <p className="mt-1 font-mono text-[22px] font-semibold tabular-nums" dir="ltr">{fmt.money(a[idx])}</p>
        </div>
        <div>
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden />
            {t("ov.prevPeriod")}
          </p>
          <p className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-muted-foreground" dir="ltr">{fmt.money(b[idx])}</p>
        </div>
        {lead !== null && (
          <span className="ms-auto rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums" dir="ltr" style={{ background: `color-mix(in oklch, ${lead >= 0 ? accent : p.accent2} 18%, transparent)`, color: lead >= 0 ? accent : p.accent2 }}>
            {lead >= 0 ? "+" : "−"}
            {Math.abs(lead).toFixed(1)}%
          </span>
        )}
      </div>

      <div
        dir="ltr"
        className="relative mt-4 flex-1 touch-pan-y"
        style={{ minHeight: 220 }}
        ref={tip.wrap}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => { setHover(null); tip.hide(); }}
        role="img"
        aria-label={`${fmt.money(totalA)} / ${fmt.money(totalB)}`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id={`${uid}-f`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: accent, stopOpacity: 0.28 }} />
              <stop offset="1" style={{ stopColor: accent, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} vectorEffect="non-scaling-stroke" strokeDasharray="1 5" style={{ stroke: "var(--color-border)" }} />
          ))}
          <path d={`${la} L ${W} ${H} L 0 ${H} Z`} fill={`url(#${uid}-f)`} style={{ opacity: mounted ? 1 : 0, transition: "opacity 900ms ease 400ms" }} />
          <path d={lb} fill="none" strokeWidth={1.5} strokeDasharray="4 5" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--color-muted-foreground)" }} />
          <path
            key={range}
            d={la}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            style={{ stroke: accent, strokeDasharray: 1, strokeDashoffset: mounted || reduced ? 0 : 1, transition: reduced ? "none" : `stroke-dashoffset 1300ms ${EASE}` }}
          />
        </svg>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-border" style={{ left, opacity: hover !== null ? 1 : 0 }} />
        <span aria-hidden className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card" style={{ left, top: `${(pa[idx][1] / H) * 100}%`, background: accent }} />
        <span aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-muted-foreground" style={{ left, top: `${(pb[idx][1] / H) * 100}%`, opacity: hover !== null ? 1 : 0 }} />
        {tip.layer}
      </div>
      <div className="mt-3 flex justify-between font-mono text-[11px] text-muted-foreground" dir="ltr" aria-hidden>
        {labels.map((l, i) => (
          <span key={i}>{shortDate(l, p.locale)}</span>
        ))}
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Sold by karat: segmented bar                                       */
/* ------------------------------------------------------------------ */

function SoldTile({ p }: { p: OverviewProps }) {
  const { t, accent, accent2 } = p;
  const mounted = useMounted();
  const items = [
    { k: "24K", v: p.sold.w24 },
    { k: "21K", v: p.sold.w21 },
    { k: "18K", v: p.sold.w18 },
    { k: t("ov.silver"), v: p.sold.silver },
  ];
  const total = items.reduce((s, a) => s + a.v, 0);
  const colors = [accent, accent2, "oklch(0.78 0.04 280)", "oklch(0.6 0.03 280)"];
  const [hover, setHover] = React.useState<number | null>(null);
  const tip = useTip(0);

  return (
    <Tile title={t("ov.soldByKarat")} className="lg:col-start-3 lg:row-start-2">
      <p className="font-mono text-[22px] font-semibold tabular-nums" dir="ltr">
        {total.toLocaleString(p.locale, { maximumFractionDigits: 1 })} <span className="text-sm text-muted-foreground">g</span>
      </p>
      {total <= 0 ? (
        <Empty>{t("ov.noSales")}</Empty>
      ) : (
        <>
          <div ref={tip.wrap} className="relative mt-4 flex h-9 gap-1" dir="ltr" onPointerLeave={() => { setHover(null); tip.hide(); }}>
            {items.map((a, i) => (
              <span
                key={a.k}
                onPointerEnter={(e) => { setHover(i); tip.showEl(e.currentTarget, <Tip rows={[[a.k, `${a.v.toLocaleString(p.locale, { maximumFractionDigits: 1 })} g · ${((a.v / total) * 100).toFixed(1)}%`, colors[i]]]} />); }}
                onPointerDown={(e) => { setHover(i); tip.showEl(e.currentTarget, <Tip rows={[[a.k, `${a.v.toLocaleString(p.locale, { maximumFractionDigits: 1 })} g · ${((a.v / total) * 100).toFixed(1)}%`, colors[i]]]} />); }}
                className="rounded-[8px]"
                style={{
                  flexBasis: mounted ? `${(a.v / total) * 100}%` : `${100 / items.length}%`,
                  minWidth: a.v > 0 ? 6 : 0,
                  background: colors[i],
                  opacity: hover === null || hover === i ? 1 : 0.3,
                  transition: `flex-basis 1000ms ${EASE} ${200 + i * 60}ms, opacity 200ms ease`,
                }}
                aria-hidden
              />
            ))}
            {tip.layer}
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-y-2">
            {items.map((a, i) => (
              <li key={a.k} className="flex items-center justify-between gap-2 text-[12px]" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: colors[i] }} aria-hidden />
                  {a.k}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums text-muted-foreground" dir="ltr">{a.v.toLocaleString(p.locale, { maximumFractionDigits: 1 })} g</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-auto pt-4 text-[11px] text-muted-foreground">{t("ov.last30")}</p>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Shop loans: solid accent tile                                      */
/* ------------------------------------------------------------------ */

function LoansTile({ p }: { p: OverviewProps }) {
  const { t, accent } = p;
  const ink = p.ink || "oklch(0.24 0.06 135)";
  const L = p.loans;
  const bars = (L?.lentDaily || []).slice(-10);
  const barDates = p.salesDates.slice(-10);
  const tip = useTip(30);
  const maxBar = Math.max(...bars, 0.001);

  return (
    <section className="relative flex min-w-0 flex-col overflow-hidden rounded-[26px] p-5 lg:col-start-4 lg:row-span-2 lg:row-start-2" style={{ background: accent, color: ink }}>
      <header className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold opacity-75">{t("ov.stockLoans")}</h3>
        {L && L.overdueCount > 0 && (
          <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold" style={{ background: "oklch(0.24 0.06 135 / 0.14)" }}>
            <span className="size-1.5 rounded-full" style={{ background: ink }} aria-hidden />
            {L.overdueCount} {t("ov.overdue")}
          </span>
        )}
      </header>

      <p className="mt-5 text-[12px] font-semibold opacity-70">{t("ov.goldStock")}</p>
      <p className="font-mono text-[40px] font-semibold leading-none tracking-[-0.05em] tabular-nums" dir="ltr">
        {p.closeGold.toLocaleString(p.locale, { maximumFractionDigits: 1 })}
        <span className="text-[18px]"> g</span>
      </p>
      <div className="mt-4 flex items-baseline justify-between rounded-2xl p-3" style={{ background: "oklch(0.24 0.06 135 / 0.1)" }}>
        <span className="text-[12px] font-semibold opacity-70">{t("ov.silverStock")}</span>
        <span className="font-mono text-[16px] font-semibold tabular-nums" dir="ltr">
          {p.closeSilver.toLocaleString(p.locale, { maximumFractionDigits: 1 })} g
        </span>
      </div>

      {!L ? (
        <p className="mt-6 text-[13px] font-medium opacity-70">{t("ov.noAccess")}</p>
      ) : (
        <>
          <p className="mt-6 text-[12px] font-semibold opacity-70">{t("ov.goldOut")}</p>
          <p className="font-mono text-[22px] font-semibold leading-none tabular-nums" dir="ltr">
            {L.goldOut.toLocaleString(p.locale, { maximumFractionDigits: 2 })}
            <span className="text-[13px]"> g</span>
          </p>

          <dl className="mt-4 space-y-1.5 text-[12px]">
            {[
              [t("ov.shopsOwingShort"), String(L.shopCount)],
              [t("ov.overdue"), String(L.overdueCount)],
              [t("ov.silverOut"), `${L.silverOut.toLocaleString(p.locale, { maximumFractionDigits: 2 })} g`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="capitalize opacity-70">{k}</dt>
                <dd className="font-mono font-semibold tabular-nums" dir="ltr">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-auto pt-6">
            <div ref={tip.wrap} className="relative flex h-12 items-end gap-1" dir="ltr" onPointerLeave={tip.hide}>
              {bars.map((e, i) => {
                const show = (el: Element) => tip.showEl(el, <Tip title={barDates[i] ? shortDate(barDates[i], p.locale) : undefined} rows={[[t("ov.lent"), `${e.toLocaleString(p.locale, { maximumFractionDigits: 2 })} g`, ink]]} />);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`${barDates[i] || ""}: ${e} g`}
                    onPointerEnter={(ev) => show(ev.currentTarget)}
                    onPointerDown={(ev) => show(ev.currentTarget)}
                    onFocus={(ev) => show(ev.currentTarget)}
                    onBlur={tip.hide}
                    className="h-full flex-1 rounded-[4px] border-0 bg-transparent p-0 shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ display: "flex", alignItems: "flex-end" }}
                  >
                    <span className="block w-full rounded-[4px]" style={{ height: `${Math.max(6, (e / maxBar) * 100)}%`, background: ink, opacity: 0.12 + (i / Math.max(bars.length, 1)) * 0.5 }} />
                  </button>
                );
              })}
              {tip.layer}
            </div>
            <p className="mt-1.5 font-mono text-[10px] opacity-60">{t("ov.lentLast10")}</p>

            <button
              type="button"
              onClick={p.onOpenLoans}
              className="mt-4 w-full rounded-2xl py-3 text-sm font-semibold transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ background: ink, color: accent }}
            >
              {t("ov.openLoans")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Cash deposit                                                       */
/* ------------------------------------------------------------------ */

function DepositTile({ p, fmt }: { p: OverviewProps; fmt: Fmt }) {
  const { t, accent, accent2 } = p;
  const D = p.deposit;
  const tip = useTip(0);
  const spentPct = D && D.deposited > 0 ? Math.min(100, (D.spent / D.deposited) * 100) : 0;
  return (
    <Tile
      title={t("ov.cashDeposit")}
      className="lg:col-start-3 lg:row-start-3"
      action={
        p.onOpenDeposit && D ? (
          <button type="button" onClick={p.onOpenDeposit} className="rounded border-0 bg-transparent p-0 font-mono text-[11px] text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("ov.details")}
          </button>
        ) : undefined
      }
    >
      {!D ? (
        <Empty>{t("ov.noAccess")}</Empty>
      ) : (
        <>
          <p className="font-mono text-[22px] font-semibold tabular-nums" dir="ltr">{fmt.money(D.balance)}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{t("ov.balance")} · {t("ov.sar")}</p>
          <div ref={tip.wrap} className="relative mt-6" dir="ltr" onPointerLeave={tip.hide}>
            <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${spentPct.toFixed(0)}%`}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${100 - spentPct}%`, background: accent, transition: `width 900ms ${EASE}` }}
                onPointerEnter={(e) => tip.showEl(e.currentTarget, <Tip rows={[[t("ov.balance"), fmt.money(D.balance), accent], [t("ov.deposited"), fmt.money(D.deposited)]]} />)}
                onPointerDown={(e) => tip.showEl(e.currentTarget, <Tip rows={[[t("ov.balance"), fmt.money(D.balance), accent], [t("ov.deposited"), fmt.money(D.deposited)]]} />)}
              />
              <div
                className="absolute inset-y-0 right-0 rounded-full"
                style={{ width: `${spentPct}%`, background: accent2, transition: `width 900ms ${EASE}` }}
                onPointerEnter={(e) => tip.showEl(e.currentTarget, <Tip rows={[[t("ov.spent"), fmt.money(D.spent), accent2], ["%", `${spentPct.toFixed(1)}%`]]} />)}
                onPointerDown={(e) => tip.showEl(e.currentTarget, <Tip rows={[[t("ov.spent"), fmt.money(D.spent), accent2], ["%", `${spentPct.toFixed(1)}%`]]} />)}
              />
            </div>
            {tip.layer}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground" dir="ltr">
            <span>{fmt.money(D.deposited)}</span>
            <span>{fmt.money(D.spent)}</span>
          </div>
          <p className="mt-auto flex justify-between pt-4 text-[12px] text-muted-foreground">
            <span>{t("ov.deposited")}</span>
            <span>{t("ov.spent")}</span>
          </p>
        </>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Entries per day                                                    */
/* ------------------------------------------------------------------ */

function EntriesTile({ p }: { p: OverviewProps }) {
  const { t, accent } = p;
  const bars = p.entriesDaily.slice(-42);
  const max = Math.max(...bars, 1);
  const total = bars.reduce((s, v) => s + v, 0);
  const avg = total / (bars.length || 1);
  const best = Math.max(...bars, 0);
  const lastIdx = bars.length - 1;
  const mounted = useMounted();
  const tip = useTip(30);
  const eDates = p.salesDates.slice(-bars.length);

  return (
    <Tile title={t("ov.entriesPerDay")} className="sm:col-span-2 lg:col-span-2 lg:col-start-1 lg:row-start-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[22px] font-semibold tabular-nums" dir="ltr">{total}</p>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{t("ov.entriesTotal")}</p>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{t("ov.last30")}</p>
      </div>
      <div ref={tip.wrap} className="relative mt-4 flex flex-1 items-end gap-[3px]" dir="ltr" style={{ minHeight: 64 }} onPointerLeave={tip.hide}>
        {bars.map((v, i) => {
          const isLast = i === lastIdx;
          const show = (el: Element) => tip.showEl(el, <Tip title={eDates[i] ? shortDate(eDates[i], p.locale) : undefined} rows={[[t("ov.entries"), String(v), isLast ? accent : "var(--color-muted-foreground)"]]} />);
          return (
            <button
              key={i}
              type="button"
              aria-label={`${eDates[i] || ""}: ${v}`}
              onPointerEnter={(e) => show(e.currentTarget)}
              onPointerDown={(e) => show(e.currentTarget)}
              onFocus={(e) => show(e.currentTarget)}
              onBlur={tip.hide}
              className="flex h-full flex-1 items-end rounded-[3px] border-0 bg-transparent p-0 shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className="block w-full rounded-[3px]"
                style={{
                  height: mounted ? `${Math.max(4, (v / max) * 100)}%` : "4%",
                  background: isLast ? accent : "var(--color-muted-foreground)",
                  opacity: isLast ? 1 : 0.15 + (i / bars.length) * 0.45,
                  transition: `height 800ms ${EASE} ${i * 14}ms`,
                }}
              />
            </button>
          );
        })}
        {tip.layer}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
        {[
          [t("ov.avgPerDay"), avg.toFixed(1)],
          [t("ov.busiestDay"), String(best)],
          [t("ov.today"), String(bars[lastIdx] ?? 0)],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums" dir="ltr">{v}</dd>
          </div>
        ))}
      </dl>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Latest entries                                                     */
/* ------------------------------------------------------------------ */

function KindIcon({ kind }: { kind: OverviewActivity["kind"] }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "sale") return <svg {...p}><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>;
  if (kind === "purchase") return <svg {...p}><path d="M12 5v14m0 0-6-6m6 6 6-6" /></svg>;
  if (kind === "supplier") return <svg {...p}><path d="M3 10h18M5 10V20M19 10V20M9 10V20M15 10V20M2 20h20M12 3 3 8h18l-9-5Z" /></svg>;
  if (kind === "expense") return <svg {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" /></svg>;
  if (kind === "deposit") return <svg {...p}><path d="M4 7h16v12H4zM4 7l2-3h12l2 3M12 11v4M10 13h4" /></svg>;
  return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
}

function ActivityTile({ p }: { p: OverviewProps }) {
  const { t, accent, accent2 } = p;
  const mounted = useMounted();
  return (
    <Tile title={t("ov.latestEntries")} className="sm:col-span-2 lg:col-span-2 lg:col-start-3 lg:row-start-4">
      {p.activity.length === 0 ? (
        <Empty>{t("ov.noEntries")}</Empty>
      ) : (
        <ul className="-mx-2 -my-1">
          {p.activity.slice(0, 4).map((a, i) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-muted/50"
              style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(6px)", transition: `opacity 500ms ease ${300 + i * 70}ms, transform 500ms ${EASE} ${300 + i * 70}ms` }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                <KindIcon kind={a.kind} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cx("truncate text-[13px] font-medium", a.status === "canceled" && "line-through opacity-60")}>{a.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {a.detail} · {a.time}
                </p>
              </div>
              <div className="text-end" dir="ltr">
                <p className={cx("font-mono text-[13px] font-medium tabular-nums", a.status === "canceled" && "line-through opacity-60")}>{a.amount}</p>
                <p className="mt-0.5 font-mono text-[10px] font-semibold" style={{ color: a.status === "canceled" ? accent2 : "var(--color-muted-foreground)" }}>
                  {a.status === "canceled" ? t("ov.canceled") : t("ov.saved")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type Fmt = { money: (v: number) => string };

export function ReportOverview(props: OverviewProps) {
  const accent = props.accent ?? "oklch(0.89 0.2 128)";
  const accent2 = props.accent2 ?? "oklch(0.74 0.12 300)";
  const p: OverviewProps = { ...props, accent, accent2 };
  const reduced = useReducedMotion();
  const fmt = React.useMemo<Fmt>(() => {
    const nf = new Intl.NumberFormat(props.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { money: (v) => nf.format(v) };
  }, [props.locale]);

  return (
    <div className={cx("w-full", props.className)}>
      <nav className="mb-3 flex flex-wrap items-center justify-end gap-3 px-1" aria-label="Overview">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium">
            <span className="size-2 rounded-full" style={{ background: accent }} aria-hidden />
            {props.t("ov.asOf")} <span className="font-mono" dir="ltr">{props.asOf}</span>
          </span>
          <span className="rounded-full bg-foreground px-3 py-1.5 font-mono text-[12px] font-semibold text-background" dir="ltr">
            {props.closeGold.toLocaleString(props.locale, { maximumFractionDigits: 1 })} g · {props.closeSilver.toLocaleString(props.locale, { maximumFractionDigits: 1 })} {props.t("ov.silver")}
          </span>
        </div>
      </nav>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroTile p={p} fmt={fmt} reduced={reduced} />
        <ShopsTile p={p} reduced={reduced} />
        <DayTile p={p} fmt={fmt} />
        <ChartTile p={p} fmt={fmt} reduced={reduced} />
        <SoldTile p={p} />
        <LoansTile p={p} />
        <DepositTile p={p} fmt={fmt} />
        <EntriesTile p={p} />
        <ActivityTile p={p} />
      </div>
    </div>
  );
}

export default ReportOverview;
