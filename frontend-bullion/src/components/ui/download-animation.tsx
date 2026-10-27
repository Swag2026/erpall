import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Animated download button (21st.dev "download-animation"): the pill collapses into a circle,
 * a progress fill rises while the job runs, and a dot orbits the circle.
 * Differences from the original: it awaits a real `onDownload` promise (minimum `minMs` so the
 * animation always reads), uses the app's accent colour and is RTL-safe.
 */
export interface DownloadButtonProps {
  /** the real work — may return a promise; the animation runs until it settles */
  onDownload?: () => void | Promise<void>;
  label?: string;
  /** accent colour of the pill / circle */
  color?: string;
  /** circle diameter (button height) */
  size?: number;
  /** expanded width */
  width?: number;
  /** minimum animation time in ms */
  minMs?: number;
  disabled?: boolean;
  className?: string;
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({
  onDownload,
  label = "Download",
  color = "#714B67",
  size = 44,
  width = 150,
  minMs = 1800,
  disabled,
  className,
}) => {
  const [busy, setBusy] = useState(false);
  const dark = `color-mix(in srgb, ${color} 55%, #000)`;
  const r = size / 2 - 3;

  const click = async () => {
    if (busy || disabled) return;
    setBusy(true);
    const t0 = Date.now();
    try {
      await onDownload?.();
    } catch {
      /* the caller reports errors */
    } finally {
      setTimeout(() => setBusy(false), Math.max(0, minMs - (Date.now() - t0)));
    }
  };

  return (
    <motion.button
      type="button"
      onClick={click}
      disabled={disabled}
      aria-busy={busy}
      aria-label={label}
      className={`relative flex items-center overflow-hidden rounded-full border-2 transition-shadow hover:shadow-md ${busy ? "cursor-wait" : disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className ?? ""}`}
      style={{ borderColor: color, background: color, height: size, minWidth: busy ? size : width }}
      animate={{ width: busy ? size : width }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
    >
      {/* orbiting dot while busy */}
      <AnimatePresence>
        {busy && (
          <motion.div
            className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-white z-20"
            initial={{ opacity: 1 }}
            animate={{ rotate: 360, x: [0, r, 0, -r, 0], y: [0, -r, 0, r, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: Math.max(1.2, minMs / 1000 - 0.3), ease: "easeInOut", times: [0, 0.25, 0.5, 0.75, 1] }}
          />
        )}
      </AnimatePresence>

      {/* circular head with icon */}
      <motion.div
        className="relative z-10 flex shrink-0 items-center justify-center rounded-full shadow-lg"
        style={{ width: size, height: size, background: color }}
        animate={busy ? { rotate: 180, scale: [0.95, 1, 0.95] } : { rotate: 0, scale: 1 }}
        transition={{ duration: busy ? 1 : 0.4, times: busy ? [0, 0.7, 1] : undefined }}
      >
        <motion.div
          className="absolute left-0 top-0 w-full rounded-full"
          style={{ background: dark, zIndex: 1 }}
          initial={{ height: "0%" }}
          animate={{ height: busy ? "100%" : "0%" }}
          transition={{ duration: busy ? Math.max(1.2, minMs / 1000 - 0.2) : 0.3, ease: "easeInOut" }}
        />
        <motion.svg
          className="z-20 text-white"
          style={{ width: size * 0.5, height: size * 0.5 }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          animate={{ opacity: busy ? 0 : 1 }}
          transition={{ duration: 0.2 }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 19V5m0 14-4-4m4 4 4-4" />
        </motion.svg>
        <motion.div
          className="absolute z-20 rounded-full bg-white"
          style={{ width: size * 0.3, height: size * 0.3 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: busy ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        />
      </motion.div>

      <AnimatePresence>
        {!busy && (
          <motion.span
            className="z-10 select-none whitespace-nowrap pe-4 ps-2 text-sm font-bold text-white"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
};
