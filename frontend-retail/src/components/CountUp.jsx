import { useEffect, useRef, useState } from 'react';

// Animates a number counting up from its previous value to the new one
// whenever `value` changes — used on Dashboard cards so figures visibly
// "arrive" instead of just popping in, a small but noticeable polish touch.
export default function CountUp({ value, duration = 550, decimals = 0, prefix = '', suffix = '' }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) { setDisplay(to); return; }
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic — fast start, gentle settle, reads as "confident" rather
      // than a linear mechanical count.
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toLocaleString('en-US');

  return <>{prefix}{formatted}{suffix}</>;
}
