import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, palette, paletteExtras, themes, type ThemeName } from "../src";

const css = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");

/** Extract `--ht-*` variables of the first rule matching `selector`. */
function vars(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--ht-([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));
}

describe("palette", () => {
  it("matches the plan (PLAN.md §1.8)", () => {
    expect(palette).toEqual({
      "honey-500": "#F5B700",
      "honey-300": "#FFD45C",
      "amber-600": "#D98E04",
      "comb-50": "#FFF8E1",
      "wax-100": "#FDEBB3",
      "bark-700": "#6B4226",
      "bark-900": "#3B2414",
      "leaf-500": "#6A8D3A",
      "ember-600": "#B23A1E",
    });
  });
});

describe("theme.css stays in sync with tokens.ts", () => {
  const cases: [ThemeName, string][] = [
    ["light", ":root"],
    ["dark", ':root[data-theme="dark"]'],
  ];
  for (const [name, selector] of cases) {
    it(name, () => {
      const parsed = vars(selector);
      for (const [key, value] of Object.entries(themes[name])) {
        expect(parsed[key], `${name}.${key}`).toBe(value.toUpperCase());
      }
    });
  }
});

describe("WCAG AA contrast", () => {
  for (const name of ["light", "dark"] as const) {
    const t = themes[name];
    const pairs: [string, string, string, number][] = [
      ["body text on page", t.fg, t.bg, 4.5],
      ["body text on card", t.fg, t.surface, 4.5],
      ["muted text on page", t["fg-muted"], t.bg, 4.5],
      ["muted text on card", t["fg-muted"], t.surface, 4.5],
      ["link on page", t.link, t.bg, 4.5],
      ["link on card", t.link, t.surface, 4.5],
      ["text on primary", t["on-primary"], t.primary, 4.5],
      ["text on primary hover", t["on-primary"], t["primary-hover"], 4.5],
      ["text on badge", t["on-badge"], t.badge, 4.5],
      ["success text on success bg", t.success, t["success-bg"], 4.5],
      ["danger text on danger bg", t.danger, t["danger-bg"], 4.5],
      ["danger text on page", t.danger, t.bg, 4.5],
      ["topbar text", t["on-topbar"], t.topbar, 4.5],
      ["focus ring on page (non-text)", t.ring, t.bg, 3],
    ];
    for (const [label, fg, bg, min] of pairs) {
      it(`${name}: ${label} ≥ ${min}`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it("white text on honey-500 is never used (it fails AA)", () => {
    expect(contrastRatio("#FFFFFF", palette["honey-500"])).toBeLessThan(4.5);
    expect(paletteExtras["amber-800"]).toBeDefined();
  });
});
