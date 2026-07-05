import { expect, test } from "@playwright/test";
import {
  installMocks,
  loadFile,
  mockCrypto,
  waitForFonts,
  waitForMockBluetoothConnected,
} from "./helpers";

// Screenshots are pixel-stable only inside the playwright Docker image.
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await installMocks(page);
  await page.goto("/");
});

// Regression test for a bug where the playback cursor bar painted on top of
// modals opened from the bottom-right badge row (Help, piano connection).
// Both badges render their own trigger button *and* their modal from the
// same component, mounted inside PracticeScreen's bottom-right row — which
// sets its own z-index and thereby caps the modal's z-index at the row's
// level, regardless of the modal's own (much higher) z-index value. The
// cursor bar's ancestors set no z-index, so its z-index leaked into the root
// stacking context above the row. The fix raises that row's z-index above
// the cursor's.
//
// This is a pixel-level regression, not a structural one: the cursor bar has
// pointer-events: none (so it doesn't block clicks on the score), which
// makes document.elementFromPoint skip right past it regardless of paint
// order — hit-testing can't tell the fixed and buggy z-index cases apart.
// Only an actual screenshot comparison catches the cursor bar painting on
// top of the modal.
test("the playback cursor does not render above the piano-connection modal", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await waitForMockBluetoothConnected(page);

  // Focus a mid-piece measure so the cursor moves onto the sheet, away from
  // beat 0, before we open the modal.
  await page.locator("svg[role='img']").click({ button: "right" });
  await page.getByRole("button", { name: "Jump to measure…" }).click();
  await page.locator('input[type="number"]').fill("60");
  await page.getByRole("button", { name: "Go" }).click();
  const cursor = page.locator('[data-cursor="true"]');
  await expect(cursor).toBeVisible();

  // Center the cursor horizontally (the reported bug was most visible with
  // the cursor behind the modal panel itself, not just the backdrop).
  await cursor.evaluate((el) =>
    el.scrollIntoView({ block: "nearest", inline: "center" }),
  );

  // Open the piano-connection modal (the badge auto-connected via the mock,
  // so clicking it shows the "connected" status modal).
  await page.getByTitle("Connected · Mock Piano").click();
  await expect(page.getByText("Piano connection")).toBeVisible();

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("modal-layering-connection-modal.png");
  }
});
