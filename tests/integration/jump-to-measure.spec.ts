import { expect, test } from "@playwright/test";
import { loadFile, mockCrypto } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await page.goto("/");
});

// Screenshot baselines are generated inside the Docker playwright image; skip
// pixel comparison outside it (same guard the other visual specs use).
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

test("jump-to-measure focuses the chosen measure", async ({ page }) => {
  await loadFile(page, "simple-grand-piano.musicxml");

  // Right-click the sheet music to open the context menu.
  await page.locator("svg[role='img']").click({ button: "right" });

  // The new "Jump to measure…" item should be present; clicking it opens the
  // numeric-input modal.
  await page.getByRole("button", { name: "Jump to measure…" }).click();

  const modal = page.getByText("Jump to measure", { exact: true });
  await expect(modal).toBeVisible();

  // Type a fixed target so the screenshot is deterministic regardless of where
  // the right-click landed (the modal defaults to the clicked measure).
  const input = page.locator('input[type="number"]');
  await input.fill("2");

  if (screenshotsEnabled) {
    await expect(page).toHaveScreenshot("jump-to-measure-modal.png");
  }

  await page.getByRole("button", { name: "Go" }).click();

  // Confirming focuses the measure: re-opening the context menu now offers the
  // focus-management items that only appear when a focus range is set.
  await page.locator("svg[role='img']").click({ button: "right" });
  await expect(page.getByRole("button", { name: "Clear focus" })).toBeVisible();
});
