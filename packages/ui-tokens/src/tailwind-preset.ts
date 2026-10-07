import type { Config } from "tailwindcss";
import { fonts, palette, paletteExtras, radii } from "./tokens";

/** Raw palette as `honey-500` → `{ honey: { 500: … } }` for Tailwind. */
function nest(colors: Record<string, string>) {
  const out: Record<string, Record<string, string>> = {};
  for (const [key, value] of Object.entries(colors)) {
    const [family, shade] = key.split("-");
    (out[family] ??= {})[shade] = value;
  }
  return out;
}

const semantic = (name: string) => `var(--ht-${name})`;

/**
 * Tailwind preset. Prefer the semantic utilities (`bg-bg`, `bg-surface`,
 * `text-fg`, `text-muted`, `border-line`, `bg-primary`…) in app code: they
 * switch with the theme. The raw palette (`bg-honey-500`) is for decoration.
 */
const preset: Partial<Config> = {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ...nest({ ...palette, ...paletteExtras }),
        bg: semantic("bg"),
        surface: semantic("surface"),
        raised: semantic("surface-raised"),
        fg: semantic("fg"),
        muted: semantic("fg-muted"),
        line: semantic("border"),
        primary: { DEFAULT: semantic("primary"), hover: semantic("primary-hover"), fg: semantic("on-primary") },
        link: semantic("link"),
        badge: { DEFAULT: semantic("badge"), fg: semantic("on-badge") },
        success: { DEFAULT: semantic("success"), bg: semantic("success-bg") },
        danger: { DEFAULT: semantic("danger"), bg: semantic("danger-bg") },
        topbar: { DEFAULT: semantic("topbar"), fg: semantic("on-topbar") },
        ring: semantic("ring"),
      },
      fontFamily: {
        heading: fonts.heading.split(", "),
        body: fonts.body.split(", "),
      },
      borderRadius: {
        sm: radii.sm,
        md: radii.md,
        lg: radii.lg,
        xl: radii.xl,
        pill: radii.pill,
      },
      boxShadow: {
        comb: "0 2px 0 0 var(--ht-border), 0 8px 24px -12px rgba(59, 36, 20, 0.35)",
      },
      keyframes: {
        buzz: {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg)" },
          "15%": { transform: "translate(-2px, -3px) rotate(-14deg)" },
          "30%": { transform: "translate(3px, -1px) rotate(12deg)" },
          "45%": { transform: "translate(-2px, 2px) rotate(-10deg)" },
          "60%": { transform: "translate(2px, -2px) rotate(8deg)" },
          "80%": { transform: "translate(-1px, 1px) rotate(-4deg)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        buzz: "buzz 600ms ease-in-out 1",
        "pop-in": "pop-in 200ms ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
};

export default preset;
