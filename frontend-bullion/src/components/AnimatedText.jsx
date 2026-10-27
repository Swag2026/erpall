import { useEffect, useState } from 'react';

// Adapted from a shadcn + Framer Motion reference component into plain
// React + CSS — this codebase has no Tailwind/TypeScript/shadcn setup
// (confirmed: no tailwind.config.js, tsconfig.json, or components.json),
// so pulling those in just for one component would mean restructuring a
// working production app. Same name, same letter-by-letter stagger +
// gradient-underline-draw effect, same default blue→purple→pink colors —
// just built with CSS keyframes + inline stagger delays instead.
export default function AnimatedText({
  text,
  duration = 0.5,
  delay = 0.1,
  replay = true,
  className = '',
  textClassName = '',
  underlineClassName = '',
  as: Component = 'h1',
  underlineGradient = 'linear-gradient(90deg, #3b82f6, #a855f7, #ec4899)', // blue -> purple -> pink, matching the reference's default
  underlineHeight = 4,
  underlineOffset = -8,
}) {
  const letters = Array.from(text);
  const [key, setKey] = useState(0);
  useEffect(() => { if (replay) setKey(k => k + 1); }, [text, replay]);

  const underlineDelay = letters.length * delay;

  // The letter row is `display:flex`, which follows the page's inherited
  // `direction`. In Arabic mode the whole app is RTL — fine for Arabic
  // text, but an English name ("Sara Cashier") in that same flex row gets
  // its letters laid out right-to-left too, so it visibly reads
  // backwards ("reihsaC araS"). Force the row's own direction to match
  // the TEXT's actual script rather than the page's, independent of
  // which language the UI happens to be in.
  const isArabicText = /[\u0600-\u06FF]/.test(text);
  const textDirection = isArabicText ? 'rtl' : 'ltr';

  return (
    <div className={`anim-text-wrap ${className}`}>
      <div className="anim-text-inner">
        <Component key={key} className={`anim-text-line ${textClassName}`} dir={textDirection} style={{ direction: textDirection }}>
          {letters.map((letter, i) => (
            <span
              key={i}
              className="anim-text-letter"
              style={{ animationDelay: `${i * delay}s`, animationDuration: `${duration}s` }}
            >
              {letter === ' ' ? '\u00A0' : letter}
            </span>
          ))}
        </Component>
        <span
          className={`anim-text-underline ${underlineClassName}`}
          style={{
            background: underlineGradient,
            height: underlineHeight,
            bottom: underlineOffset,
            animationDelay: `${underlineDelay}s`,
          }}
        />
      </div>
    </div>
  );
}
