import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  ["feed", "/"],
  ["leaderboard", "/leaderboard"],
  ["game", "/games/velvet-voyage"],
  ["profile", "/u/queenbee"],
  ["search", "/search?q=garden"],
  ["login", "/login"],
  ["register", "/register"],
  ["upload (logged out)", "/upload"],
] as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe (WCAG 2.1 A/AA), ${scheme} mode`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, path] of PAGES) {
      test(name, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500); // let skeletons resolve
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
        expect(summary, summary.join("\n")).toEqual([]);
      });
    }
  });
}

test("everything is reachable by keyboard: skip link, tabs and the login dialog trap focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  await page.getByRole("button", { name: "Log in" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // focus stays inside the modal
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Log in" })).toBeFocused();
});

test("the focus ring is visible on interactive elements", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.getByRole("tab", { name: "Top Games" }).focus();
  const outline = await page.getByRole("tab", { name: "Top Games" }).evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
});

test("reduced motion disables the buzz animation", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/games/velvet-voyage");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("dialog").getByLabel(/Email or username/).fill("demo@honeytree.dev");
  await page.getByRole("dialog").getByLabel("Password").fill("honeytree123");
  await page.getByRole("dialog").getByRole("button", { name: "Log in" }).click();
  await page.getByTestId("like-button").first().click();
  const dur = await page.getByTestId("like-button").first().locator("span").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(dur)).toBeLessThan(0.01);
  await ctx.close();
});
