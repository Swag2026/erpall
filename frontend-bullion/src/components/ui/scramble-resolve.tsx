import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Scramble → resolve" text effect: every letter starts as a random glyph and locks into the real
 * character one after another. Plain React (no Remotion). Works for Latin and Arabic (the
 * scramble uses glyphs of the same script) and respects prefers-reduced-motion.
 */
const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=<>?";
const ARABIC = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";
const isArabic = (s: string) => /[؀-ۿ]/.test(s);

export interface ScrambleResolveProps extends React.HTMLAttributes<HTMLSpanElement> {
  text: string;
  /** ms before the first letter starts resolving */
  delay?: number;
  /** total ms for the whole text to resolve */
  duration?: number;
  /** replay when hovered */
  replayOnHover?: boolean;
  /** colour of letters that are still scrambling */
  scrambleColor?: string;
}

export const ScrambleResolve: React.FC<ScrambleResolveProps> = ({
  text,
  delay = 150,
  duration = 1100,
  replayOnHover = true,
  scrambleColor = "var(--accent-fg)",
  className,
  style,
  ...rest
}) => {
  const [out, setOut] = useState<{ ch: string; done: boolean }[]>(() => [...text].map((ch) => ({ ch, done: true })));
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const run = useCallback(() => {
    cancelAnimationFrame(raf.current);
    clearTimeout(timer.current);
    const chars = [...text];
    const pool = isArabic(text) ? ARABIC : LATIN;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !chars.length || isArabic(text)) {
      setOut(chars.map((ch) => ({ ch, done: true })));
      return;
    }
    const n = chars.length;
    // each letter locks at its own moment (left→right in reading order, with a little jitter)
    const lockAt = chars.map((_, i) => (i / n) * duration * 0.8 + Math.random() * duration * 0.2);
    setOut(chars.map((ch) => ({ ch: ch === " " ? " " : pool[Math.floor(Math.random() * pool.length)], done: ch === " " })));
    timer.current = setTimeout(() => {
      const t0 = performance.now();
      let last = 0;
      const tick = (now: number) => {
        const el = now - t0;
        if (now - last > 45 || el >= duration) {
          last = now;
          setOut(
            chars.map((ch, i) =>
              ch === " " || el >= lockAt[i]
                ? { ch, done: true }
                : { ch: pool[Math.floor(Math.random() * pool.length)], done: false },
            ),
          );
        }
        if (el < duration) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }, delay);
  }, [text, delay, duration]);

  useEffect(() => {
    run();
    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(timer.current);
    };
  }, [run]);

  if (isArabic(text)) {
    return <span className={className} style={style} {...rest}>{text}</span>;
  }

  return (
    <span
      className={className}
      style={style}
      aria-label={text}
      onMouseEnter={replayOnHover ? run : undefined}
      {...rest}
    >
      <span aria-hidden="true">
        {out.map((o, i) => (
          <span key={i} style={o.done ? undefined : { color: scrambleColor, opacity: 0.85 }}>
            {o.ch}
          </span>
        ))}
      </span>
    </span>
  );
};

export default ScrambleResolve;
