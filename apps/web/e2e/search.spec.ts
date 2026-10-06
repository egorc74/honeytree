import { expect, test } from "@playwright/test";

test.describe("search", () => {
  test("autocomplete supports keyboard navigation and finds games by a misspelled title", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("combobox", { name: "Search games and creators" });
    await box.fill("velvt voyge");
    const list = page.getByRole("listbox", { name: "Search suggestions" });
    await expect(list.getByRole("option", { name: /Velvet Voyage/ })).toBeVisible();

    // ArrowDown moves the active option; Enter opens it
    await box.press("ArrowDown");
    await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
    await box.press("Enter");
    await expect(page).toHaveURL(/\/games\/velvet-voyage/);
  });

  test("Escape closes the dropdown, Enter without a selection opens the results page", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("combobox", { name: "Search games and creators" });
    await box.fill("queenbee");
    await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();
    await box.press("Escape");
    await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeHidden();
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=queenbee/);
  });

  test("results page: Games | Creators tabs and tag filters", async ({ page }) => {
    await page.goto("/search?q=garden");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("garden");
    await expect(page.getByRole("list", { name: "Game results" }).getByTestId("game-card").first()).toBeVisible();

    // tag filter narrows results; state is in the URL
    const tag = page.getByRole("group", { name: "Filter by tag" }).getByRole("button").first();
    const tagName = (await tag.textContent())!.replace("#", "");
    await tag.click();
    await expect(page).toHaveURL(new RegExp(`tags=${tagName}`));
    await expect(tag).toHaveAttribute("aria-pressed", "true");
    for (const card of await page.getByTestId("game-card").all()) {
      await expect(card.getByRole("list", { name: "Tags" })).toContainText(`#${tagName}`);
    }

    await page.goto("/search?q=queenbee");
    await page.getByRole("tab", { name: "Creators" }).click();
    await expect(page).toHaveURL(/type=users/);
    await expect(page.getByRole("list", { name: "Creator results" }).getByText("@queenbee")).toBeVisible();
    await page.getByRole("link", { name: /Queenbee/ }).first().click();
    await expect(page).toHaveURL(/\/u\/queenbee/);
    await expect(page.getByRole("heading", { level: 1, name: "Queenbee" })).toBeVisible();
  });

  test("shows an empty state when nothing matches", async ({ page }) => {
    await page.goto("/search?q=zzzzqqqq");
    await expect(page.getByText("No games found")).toBeVisible();
  });
});
