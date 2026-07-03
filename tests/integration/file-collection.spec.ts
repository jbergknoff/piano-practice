import { expect, test } from "@playwright/test";
import { installMocks, loadFile, mockCrypto } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await installMocks(page);
  await page.goto("/");
});

function backButton(page: import("@playwright/test").Page) {
  return page.getByTitle("Back to your pieces");
}

test("a loaded file auto-resumes into the practice screen after reload", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");

  await page.reload();

  await page.waitForSelector("svg[role='img'] text", { timeout: 10_000 });
  await expect(backButton(page)).toBeVisible();
});

test("returning to landing shows the loaded piece in the library list", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");

  await backButton(page).click();

  await expect(page.getByText("c major melody")).toBeVisible();
});

test("clicking a library row loads that piece", async ({ page }) => {
  await loadFile(page, "c-major-melody.mid");
  await backButton(page).click();

  await page.getByText("c major melody").click();

  await page.waitForSelector("svg[role='img'] text", { timeout: 10_000 });
});

test("deleting a library entry removes it and its history", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await backButton(page).click();
  await expect(page.getByText("c major melody")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTitle("Delete").click();

  await expect(page.getByText("c major melody")).not.toBeVisible();

  // With the library now empty, a reload should land on the plain landing
  // screen rather than auto-resuming the deleted piece.
  await page.reload();
  await expect(page.locator('input[type="file"]')).toBeVisible();
  await expect(page.getByText("c major melody")).not.toBeVisible();
});

test("auto-resume picks the more recently opened of two pieces, and the older one stays in the library", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await backButton(page).click();
  await loadFile(page, "g-major-melody.mid");

  await page.reload();
  await page.waitForSelector("svg[role='img'] text", { timeout: 10_000 });

  await backButton(page).click();
  await expect(page.getByText("g major melody")).toBeVisible();
  await expect(page.getByText("c major melody")).toBeVisible();
});
