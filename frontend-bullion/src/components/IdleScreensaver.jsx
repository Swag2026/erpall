import { useEffect, useRef, useState } from 'react';
import { SpiralAnimation } from './ui/spiral-animation.tsx';

// Watches for mouse/keyboard/touch activity anywhere in the app. After
// IDLE_MS with no activity, shows the spiral animation full-screen as a
// screensaver — any activity (move, click, key, scroll, touch) dismisses
// it immediately and resets the idle timer.
const IDLE_MS = 20_000; // 20s of no activity

export default function IdleScreensaver() {
  const [active, setActive] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const resetTimer = () => {
      setActive(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setActive(true), IDLE_MS);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!active) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 999997, cursor: 'pointer' }}
      onClick={() => setActive(false)}
    >
      <SpiralAnimation />
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        pointerEvents: 'none',
      }}>
        <img
          src="/logo.png"
          alt="Swag Bullion"
          style={{ width: 160, height: 160, objectFit: 'contain' }}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div style={{
          fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 34,
          color: '#F2CA4C', letterSpacing: '0.02em',
        }}>
          Swag Bullion
        </div>
      </div>
    </div>
  );
}
