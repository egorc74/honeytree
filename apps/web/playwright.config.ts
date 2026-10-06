import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
// By default e2e runs against the in-browser API mocks. Set E2E_API=real to run against the real stack
// (docker compose up + seeded API); the same specs use only the public UI.
const mocking = process.env.E2E_API !== "real";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm build && pnpm exec next start -p ${PORT}`,
        url: baseURL,
        timeout: 300_000,
        reuseExistingServer: !process.env.CI,
        env: { NEXT_PUBLIC_API_MOCKING: mocking ? "enabled" : "disabled", NEXT_PUBLIC_SITE_URL: baseURL },
      },
});
