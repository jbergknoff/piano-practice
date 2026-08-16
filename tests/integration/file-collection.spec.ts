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

test("deleting a library entry removes it from the list but keeps its practice history", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");

  // Switch to Wait mode and let the debounced FileHistory save flush before
  // navigating away, so there's a non-default mode to check survives delete.
  await page.getByRole("button", { name: "Wait" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-color-id]").length > 0,
    null,
    { timeout: 2_000 },
  );
  await page.waitForTimeout(600);

  await backButton(page).click();
  await expect(page.getByText("c major melody")).toBeVisible();
  await expect(page.getByText("wait", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTitle("Delete").click();
  await expect(page.getByText("c major melody")).not.toBeVisible();

  // Reopening the identical file recreates its library entry under the same
  // content hash — its saved mode reappears because delete only removed the
  // cached bytes/list entry, not FileHistory.
  await loadFile(page, "c-major-melody.mid");
  await backButton(page).click();
  await expect(page.getByText("c major melody")).toBeVisible();
  await expect(page.getByText("wait", { exact: true })).toBeVisible();
});

test("opening a second file from the practice screen never flashes the landing screen", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");

  // A MutationObserver (not polling) is what catches the flash: the landing
  // screen used to be committed in its own render, between the state reset
  // and the parsed file landing, so it could come and go inside a frame.
  await page.evaluate(() => {
    (window as Window & { __landingSeen?: boolean }).__landingSeen = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Drop a piece here")) {
        (window as Window & { __landingSeen?: boolean }).__landingSeen = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await loadFile(page, "g-major-melody.mid");
  await expect(page.getByText("g major melody")).toBeVisible();

  expect(
    await page.evaluate(
      () => (window as Window & { __landingSeen?: boolean }).__landingSeen,
    ),
  ).toBe(false);
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
