import { expect, test } from "@playwright/test";

test.describe("mobile layout", () => {
  test("shows the bottom tab bar and no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("navigation", { name: "Main (mobile)" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "Feed" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Main", exact: true })).toBeHidden(); // desktop tabs hidden
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  for (const path of ["/leaderboard", "/games/velvet-voyage", "/u/queenbee", "/search?q=garden", "/upload"]) {
    test(`${path} fits the viewport`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test("tabs navigate between Feed and Leaderboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main (mobile)" }).getByRole("link", { name: "Leaderboard" }).click();
    await expect(page).toHaveURL(/\/leaderboard/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Leaderboard");
  });
});
