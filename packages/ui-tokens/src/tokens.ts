/**
 * Honeytree design tokens (PLAN.md §1.8).
 * Raw palette values are the source of truth; `theme.css` maps them to
 * semantic CSS variables for light and dark mode.
 */

export const palette = {
  "honey-500": "#F5B700", // primary buttons, active tab, like button
  "honey-300": "#FFD45C", // hover, highlights
  "amber-600": "#D98E04", // badges, decorative accents
  "comb-50": "#FFF8E1", // page background (light mode)
  "wax-100": "#FDEBB3", // cards and panels
  "bark-700": "#6B4226", // secondary text, borders
  "bark-900": "#3B2414", // headings, top bar, dark-mode background
  "leaf-500": "#6A8D3A", // success, "accepted" suggestion
  "ember-600": "#B23A1E", // errors, destructive actions
} as const;

/**
 * Extra shades that are NOT in the plan's table. They exist only so text
 * stays WCAG AA: `amber-600` on `comb-50` is ~2.6:1, so link text uses
 * `amber-800`, and `leaf-500` text on light surfaces uses `leaf-700`.
 */
export const paletteExtras = {
  "amber-800": "#7A4F00",
  "leaf-700": "#4A6623",
  "bark-800": "#4D2F1B",
  "bark-950": "#2A190E",
  "wax-200": "#F8DD8E",
} as const;

export type PaletteKey = keyof typeof palette | keyof typeof paletteExtras;

export const fonts = {
  heading: '"Fredoka Variable", "Fredoka", ui-rounded, "Nunito", system-ui, sans-serif',
  body: '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

/** 4px base spacing scale, in rem. */
export const spacing = {
  0: "0",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
} as const;

export const radii = {
  sm: "0.5rem",
  md: "0.875rem",
  lg: "1.25rem",
  xl: "1.75rem",
  pill: "9999px",
} as const;

export const motion = {
  fast: "120ms",
  base: "200ms",
  slow: "400ms",
} as const;

/** Semantic color roles per theme. Values are palette hex codes. */
export const themes = {
  light: {
    bg: palette["comb-50"],
    surface: palette["wax-100"],
    "surface-raised": "#FFFFFF",
    fg: palette["bark-900"],
    "fg-muted": palette["bark-700"],
    border: "#E2C77A",
    primary: palette["honey-500"],
    "primary-hover": palette["honey-300"],
    "on-primary": palette["bark-900"],
    link: paletteExtras["amber-800"],
    badge: palette["amber-600"],
    "on-badge": palette["bark-900"],
    success: paletteExtras["leaf-700"],
    "success-bg": "#E4EDD3",
    danger: palette["ember-600"],
    "danger-bg": "#F8DDD6",
    topbar: palette["bark-900"],
    "on-topbar": palette["comb-50"],
    ring: palette["bark-900"],
  },
  dark: {
    bg: paletteExtras["bark-950"],
    surface: palette["bark-900"],
    "surface-raised": paletteExtras["bark-800"],
    fg: palette["comb-50"],
    "fg-muted": "#E3CFA0",
    border: "#6B4226",
    primary: palette["honey-500"],
    "primary-hover": palette["honey-300"],
    "on-primary": palette["bark-900"],
    link: palette["honey-300"],
    badge: palette["amber-600"],
    "on-badge": palette["bark-900"],
    success: "#A3C76B",
    "success-bg": "#2E3A1B",
    danger: "#F2917A",
    "danger-bg": "#4A1F14",
    topbar: palette["bark-900"],
    "on-topbar": palette["comb-50"],
    ring: palette["honey-300"],
  },
} as const;

export type ThemeName = keyof typeof themes;
export type SemanticColor = keyof (typeof themes)["light"];

/** Badge look per feed list (PLAN.md §1.2). */
export const badgeKinds = {
  fresh: { label: "Fresh Nectar", emoji: "🆕" },
  sweetest: { label: "Sweetest", emoji: "🍯" },
  buzzing: { label: "Buzzing", emoji: "🐝" },
} as const;

export type BadgeKind = keyof typeof badgeKinds;
