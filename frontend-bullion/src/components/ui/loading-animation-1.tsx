import React, { useEffect, useRef } from 'react';

export interface ConcentricRingsLoaderProps {
  size?: number;
  color?: string;
  text?: string;
  showText?: boolean;
  rings?: number;
}

/** Concentric pulsing rings with orbiting dots (canvas). `color` must be #rrggbb. */
const ConcentricRingsLoader = ({ size = 120, color = '#eb3b5a', text = 'Loading...', showText = true, rings = 4 }: ConcentricRingsLoaderProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = size;
    canvas.height = size;
    const cx = size / 2, cy = size / 2;
    let time = 0;
    const animate = () => {
      ctx.clearRect(0, 0, size, size);
      for (let i = 0; i < rings; i++) {
        const base = size * 0.1 + i * (size * 0.15);
        const pulse = Math.sin(time * 0.03 - i * 0.5) * (size * 0.05);
        const radius = Math.min(base + pulse, size / 2 - 2);
        const opacity = Math.max(0, 0.2 + Math.sin(time * 0.03 - i * 0.5) * 0.3);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`;
        ctx.lineWidth = 2;
        ctx.stroke();
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * Math.PI * 2 + time * 0.02 * (i % 2 ? 1 : -1);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
      const cp = Math.sin(time * 0.05) * 0.3 + 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * cp, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      time++;
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animationRef.current);
  }, [size, color, rings]);

  return (
    <div className="concentric-rings-loader" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      {showText && <div className="loader-text" style={{ color, fontSize: 13, fontWeight: 600, animation: 'fade 1.6s ease-in-out infinite' }}>{text}</div>}
    </div>
  );
};

export default ConcentricRingsLoader;
