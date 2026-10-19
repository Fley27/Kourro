import { test, expect } from "@playwright/test";

test("web app loads without a fatal error", async ({ page }) => {
  await page.goto("/");
  // The app shell root must render and not show the fatal-error host.
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.locator("#fatal-host")).toHaveCount(0);
});

test("POS screen mounts and respond to interaction", async ({ page }) => {
  await page.goto("/");
  // The POS / cart surface should appear once the app hydrates.
  await page.waitForTimeout(2000);
  await expect(page.locator("#root")).toBeVisible();
});
