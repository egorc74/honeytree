import { expect, type Page } from "@playwright/test";

/** 1×1 PNG. */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export const file = {
  png: (name: string) => ({ name, mimeType: "image/png", buffer: PNG }),
  build: (name = "mygame-win.zip") => ({ name, mimeType: "application/zip", buffer: Buffer.alloc(4096, 1) }),
  video: (name = "trailer.mp4") => ({ name, mimeType: "video/mp4", buffer: Buffer.alloc(4096, 2) }),
};

export function uniqueName(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.toLowerCase();
}

export async function register(page: Page, username: string) {
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("avatar-menu")).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByTestId("avatar-menu").click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
}

export async function login(page: Page, who: string) {
  await page.getByRole("button", { name: "Log in" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Email or username/).fill(who);
  await dialog.getByLabel("Password").fill("correct-horse-battery");
  await dialog.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("avatar-menu")).toBeVisible();
}

/** Creates and publishes a game through the upload wizard. Returns its URL path. */
export async function publishGame(page: Page, title: string) {
  await page.goto("/upload");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("One-line pitch").fill("A tiny test game about bees.");
  await page.getByLabel("Description (Markdown)").fill("## Hello\n\nThis is **great**.");
  await page.locator("#tag-input").fill("puzzle");
  await page.locator("#tag-input").press("Enter");
  await page.getByText("Windows", { exact: true }).click();
  await page.getByTestId("wizard-next").click();

  // Step 2: build
  await page.getByTestId("build-input").setInputFiles(file.build());
  await expect(page.getByTestId("build-item").getByText("Ready")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("wizard-next").click();

  // Step 3: cover, screenshots, video
  await page.getByTestId("cover-input").setInputFiles(file.png("cover.png"));
  await page.getByTestId("screenshot-input").setInputFiles([file.png("s1.png"), file.png("s2.png"), file.png("s3.png")]);
  await page.getByTestId("video-input").setInputFiles(file.video());
  await expect(page.getByTestId("screenshot-item")).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByTestId("video-item").getByText("Ready")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("wizard-next").click();

  // Step 4: preview → publish
  await expect(page.getByTestId("requirements").locator("li.text-danger")).toHaveCount(0, { timeout: 20_000 });
  await page.getByTestId("publish-button").click();
  await expect(page).toHaveURL(/\/games\//);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return new URL(page.url()).pathname;
}
