/** @type {import('tailwindcss').Config} */
module.exports = {
  // This app toggles data-theme="dark"/"light" on <html> (see
  // ThemeContext.jsx), never a .dark class — pointing Tailwind's dark:
  // variant at that same attribute is what makes dark:-prefixed utilities
  // in pasted components (e.g. ImagesBadge's dark:bg-zinc-900/80) actually
  // follow the app's real theme instead of never firing.
  darkMode: ["selector", '[data-theme="dark"]'],
  // Preflight (Tailwind's global CSS reset) is OFF on purpose — this app
  // already has its own hand-written base styles (buttons, inputs, etc.
  // in globals.css) for the existing dark/gold theme. Preflight resets
  // element-level defaults globally and would fight with that everywhere,
  // not just around the new component. Utility classes (bg-background,
  // border-border, etc.) still work fine without it.
  corePlugins: { preflight: false },
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: { DEFAULT: "hsl(var(--primary) / <alpha-value>)", foreground: "hsl(var(--primary-foreground) / <alpha-value>)" },
        secondary: { DEFAULT: "hsl(var(--secondary) / <alpha-value>)", foreground: "hsl(var(--secondary-foreground) / <alpha-value>)" },
        destructive: { DEFAULT: "hsl(var(--destructive) / <alpha-value>)", foreground: "hsl(var(--destructive-foreground) / <alpha-value>)" },
        muted: { DEFAULT: "hsl(var(--muted) / <alpha-value>)", foreground: "hsl(var(--muted-foreground) / <alpha-value>)" },
        accent: { DEFAULT: "hsl(var(--accent) / <alpha-value>)", foreground: "hsl(var(--accent-foreground) / <alpha-value>)" },
        popover: { DEFAULT: "hsl(var(--popover) / <alpha-value>)", foreground: "hsl(var(--popover-foreground) / <alpha-value>)" },
        card: { DEFAULT: "hsl(var(--card) / <alpha-value>)", foreground: "hsl(var(--card-foreground) / <alpha-value>)" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
