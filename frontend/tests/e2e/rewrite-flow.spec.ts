import { expect, test } from "@playwright/test";

test("rewrite studio shows core controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("OpenRewrite Studio")).toBeVisible();
  await expect(page.getByLabel("Original text")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rewrite" })).toBeVisible();
  await expect(page.locator("header").getByText("Meaning Lock")).toBeVisible();
});

test("rewrite studio avoids horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("OpenRewrite Studio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rewrite" })).toBeVisible();

  const hasNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(hasNoHorizontalOverflow).toBe(true);
});
