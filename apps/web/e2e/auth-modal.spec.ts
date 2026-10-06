import { expect, test } from "@playwright/test";
import { uniqueName } from "./helpers";

test("protected actions open the login modal and continue after login", async ({ page }) => {
  await page.goto("/games/velvet-voyage");
  const like = page.getByTestId("like-button").first();
  await expect(like).toHaveAttribute("data-liked", "false");
  await like.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  // switch to sign up inside the modal
  await dialog.getByRole("button", { name: "Create an account" }).click();
  const name = uniqueName("modal");
  await dialog.getByLabel("Username").fill(name);
  await dialog.getByLabel("Email").fill(`${name}@example.com`);
  await dialog.getByLabel("Password").fill("correct-horse-battery");
  await dialog.getByRole("button", { name: "Create account" }).click();

  // the like the user wanted is applied right after authentication, with the karma toast
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("like-button").first()).toHaveAttribute("data-liked", "true");
  await expect(page.getByTestId("karma-toast")).toContainText("+1 karma");
});

test("Escape closes the modal without side effects", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the Profile tab asks anonymous visitors to log in, then opens their profile", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByText("Log in to see your profile")).toBeVisible();
  await page.getByRole("button", { name: "Log in" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Email or username/).fill("demo@honeytree.dev");
  await dialog.getByLabel("Password").fill("honeytree123");
  await dialog.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/u\/demo/);
  await expect(page.getByRole("heading", { level: 1, name: "Demo Bee" })).toBeVisible();
});

test("shows a friendly error for wrong credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/Email or username/).fill("nobody@example.com");
  await page.getByLabel("Password").fill("nope-nope-nope");
  await page.getByRole("form", { name: "Log in" }).getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Wrong email or password" })).toBeVisible();
});
