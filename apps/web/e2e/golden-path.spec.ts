import { expect, test } from "@playwright/test";
import { login, logout, publishGame, register, uniqueName, file } from "./helpers";

/**
 * PLAN.md §4 Agent 2 Phase 4: sign up → upload → publish → another user likes, reviews and
 * comments → profile stats and leaderboard update.
 */
test("creator publishes, a gamer engages, stats and leaderboard update", async ({ page }) => {
  const creator = uniqueName("maker");
  const gamer = uniqueName("gamer");
  const title = `Bee Quest ${creator.slice(-4)}`;

  // 1. Creator signs up and publishes a game
  await register(page, creator);
  const gamePath = await publishGame(page, title);

  // The new game appears in the feed with the Fresh badge
  await page.goto("/");
  const card = page.getByTestId("game-card").filter({ hasText: title }).first();
  await expect(card.getByTestId("badge-fresh")).toBeVisible();

  await logout(page);

  // 2. A second user finds and engages with it
  await register(page, gamer);
  await page.goto(gamePath);

  const downloads = page.getByTestId("downloads-count");
  await expect(downloads).toHaveText("0");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-button").click();
  await downloadPromise;
  await expect(downloads).toHaveText("1");

  // like (+1 karma toast)
  await page.getByTestId("like-button").first().click();
  await expect(page.getByTestId("karma-toast").first()).toContainText("+1 karma");
  await expect(page.getByTestId("like-button").first()).toHaveAttribute("data-liked", "true");

  // review (≥20 chars → +3 karma)
  await page.getByRole("radio", { name: "5 stars" }).click();
  await page.getByLabel("Your thoughts").fill("Absolutely delightful, I loved every minute.");
  await page.getByRole("button", { name: "Post review" }).click();
  await expect(page.getByTestId("review").filter({ hasText: "Absolutely delightful" })).toBeVisible();

  // comment and suggestion
  await page.getByLabel("Your comment").fill("Great art style!");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByTestId("comment").filter({ hasText: "Great art style!" })).toBeVisible();

  await page.getByRole("radio", { name: "💡 Suggestion" }).click();
  await page.getByLabel("Your suggestion for the creator").fill("Please add a hard mode.");
  await page.getByRole("button", { name: "Post suggestion" }).click();
  const suggestion = page.getByTestId("suggestion").filter({ hasText: "Please add a hard mode." });
  await expect(suggestion).toBeVisible();

  // gamer karma = 1 (like) + 3 (review) + 2 (comment) + 3 (suggestion) = 9
  await page.goto(`/u/${gamer}`);
  await expect(page.getByTestId("stat-karma")).toContainText("9");

  await logout(page);

  // 3. The creator accepts the suggestion and likes it
  await login(page, creator);
  await page.goto(gamePath);
  const sug = page.getByTestId("suggestion").filter({ hasText: "Please add a hard mode." });
  await sug.getByTestId("like-button").click();
  await sug.getByRole("button", { name: /Accept suggestion/ }).click();
  await expect(sug.getByText("✅ Accepted")).toBeVisible();

  // 4. Creator stats: 1 game, 1 like received, rating 5.0 from 1 review; no karma for own content
  await page.goto(`/u/${creator}`);
  await expect(page.getByTestId("stat-games")).toContainText("1");
  await expect(page.getByTestId("stat-likes")).toContainText("1");
  await expect(page.getByTestId("stat-rating")).toContainText("5.0");
  await expect(page.getByTestId("stat-rating")).toContainText("1 review");
  // creator liked the suggestion (+1 karma); nothing for actions on their own game
  await expect(page.getByTestId("stat-karma")).toContainText("1");

  // The accepted suggestion rewards the gamer +10 → 19
  await logout(page);
  await page.goto(`/u/${gamer}`);
  await expect(page.getByTestId("stat-karma")).toContainText("19");

  // 5. Leaderboards
  await page.goto("/leaderboard");
  await page.getByRole("radio", { name: "All time" }).click();
  await page.getByRole("tab", { name: "Top Games" }).click();
  await expect(page.getByTestId("leaderboard-row").filter({ hasText: title })).toBeVisible();
  await page.getByRole("tab", { name: "Top Creators" }).click();
  await expect(page.getByTestId("leaderboard-row").filter({ hasText: creator })).toBeVisible();
  await page.getByRole("tab", { name: "Top Karma" }).click();
  await expect(page.getByTestId("leaderboard-row").filter({ hasText: gamer })).toBeVisible();
});

test("rejects an infected upload (EICAR)", async ({ page }) => {
  const maker = uniqueName("av");
  await register(page, maker);
  await page.goto("/upload");
  await page.getByLabel("Title").fill("Virus Test");
  await page.getByLabel("One-line pitch").fill("test");
  await page.getByText("Windows", { exact: true }).click();
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("build-input").setInputFiles(file.build("eicar-test.zip"));
  await expect(page.getByTestId("pending-uploads").getByText("Rejected")).toBeVisible({ timeout: 20_000 });
});
