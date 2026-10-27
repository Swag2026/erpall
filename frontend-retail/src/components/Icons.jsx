// Small, consistent stroke-icon set (Lucide/Feather style) — replaces the
// emoji characters (✕ 📎 🔒 ⎙ 📤 ⚠) that were used as placeholder icons.
// Each is a plain inline SVG so no icon-font/library dependency is needed.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconX({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconLock({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function IconPaperclip({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48" />
    </svg>
  );
}

export function IconPrinter({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

export function IconShare({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5" />
    </svg>
  );
}

export function IconDownload({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function IconSend({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

export function IconMegaphone({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="m3 11 18-5v12L3 13v-2Z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}

export function IconHome({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

export function IconPlusCircle({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export function IconList({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

export function IconMenu({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

// Official Saudi Riyal currency symbol — approved by King Salman (Feb 2025),
// used by SAMA, banks (e.g. Al Rajhi), and government systems. This is the
// real official vector path (not a hand-drawn approximation, and not
// dependent on a webfont loading correctly).
export function IconPhone({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function IconVideo({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="m23 7-7 5 7 5V7Z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

export function IconVideoOff({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m4 0h4a2 2 0 0 1 2 2v3.5l7-5v11l-5.5-3.5" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function IconMic({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
    </svg>
  );
}

export function IconMicOff({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M9 9v2a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2M12 19v3M8 22h8M2 2l20 20" />
    </svg>
  );
}

export function IconPhoneOff({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function IconMinimize({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

export function IconMaximize({ size = 16, ...props }) {
  return (
    <svg {...base} width={size} height={size} {...props}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

export function IconSaudiRiyal({ size = 14, style = {}, ...props }) {
  return (
    <svg
      viewBox="0 0 1256 1256" width={size} height={size}
      fill="currentColor"
      style={{ display: 'inline-block', verticalAlign: '-0.05em', flexShrink: 0, ...style }}
      {...props}
    >
      <path d="M0,0M750,1119 C730,1163,716,1211,711,1262 C711,1262,1136,1172,1136,1172 C1156,1127,1169,1079,1174,1028 C1174,1028,750,1119,750,1119Z M1136,901 C1136,901,1136,901,1136,901 C1156,857,1169,809,1174,758 C1174,758,843,828,843,828 C843,828,843,693,843,693 C843,693,1136,631,1136,631 C1156,587,1169,538,1174,488 C1174,488,843,558,843,558 C843,558,843,72,843,72 C793,100,748,138,711,183 C711,183,711,586,711,586 C711,586,579,614,579,614 C579,614,579,6,579,6 C528,34,483,72,447,117 C447,117,447,642,447,642 C447,642,151,705,151,705 C131,750,117,798,112,849 C112,849,447,777,447,777 C447,777,447,948,447,948 C447,948,88,1024,88,1024 C68,1068,55,1117,50,1167 C50,1167,425,1088,425,1088 C456,1081,482,1063,499,1038 C499,1038,568,936,568,936 C568,936,568,936,568,936 C575,926,579,913,579,899 C579,899,579,749,579,749 C579,749,711,721,711,721 C711,721,711,992,711,992 C711,992,1136,901,1136,901Z" />
    </svg>
  );
}
