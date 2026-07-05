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
// This positions the cursor at screen-center (matching the reported bug,
// where the cursor visibly cut through the "Connect a piano" modal), opens
// the piano-connection modal, and screenshots the result.
test("the playback cursor does not render above the piano-connection modal", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await waitForMockBluetoothConnected(page);
  // Settle glyph layout before measuring any positions below — a font swap
  // mid-measurement would shift note metrics by a fraction of a pixel and
  // make the scroll math (and the final screenshot) nondeterministic.
  await waitForFonts(page);

  // Focus a mid-piece measure so the cursor moves well into the score,
  // away from beat 0, before we manually center it.
  await page.locator("svg[role='img']").click({ button: "right" });
  await page.getByRole("button", { name: "Jump to measure…" }).click();
  await page.locator('input[type="number"]').fill("60");
  await page.getByRole("button", { name: "Go" }).click();

  const cursor = page.locator('[data-cursor="true"]');
  await expect(cursor).toBeVisible();

  // Scroll the sheet so the cursor sits exactly at the viewport's horizontal
  // center — the position where the reported bug was visible.
  await page.evaluate(() => {
    const container = document.querySelector(
      "[data-testid='sheet-music-scroll-container']",
    ) as HTMLElement | null;
    const cursorEl = document.querySelector(
      '[data-cursor="true"]',
    ) as HTMLElement | null;
    if (!container || !cursorEl) {
      throw new Error("expected both the scroll container and the cursor");
    }
    const containerRect = container.getBoundingClientRect();
    const cursorRect = cursorEl.getBoundingClientRect();
    const delta =
      cursorRect.left +
      cursorRect.width / 2 -
      (containerRect.left + containerRect.width / 2);
    container.scrollLeft += delta;
  });

  // Open the piano-connection modal (the badge auto-connected via the mock,
  // so clicking it shows the "connected" status modal).
  await page.getByTitle("Connected · Mock Piano").click();
  const modal = page.locator('[data-testid="connection-modal"]');
  await expect(modal).toBeVisible();

  // This is a pixel-level regression, not a DOM/structural one: the cursor
  // bar has pointer-events: none (so it doesn't block clicks on the score),
  // which makes document.elementFromPoint skip right past it regardless of
  // paint order, so hit-testing can't tell the two z-index cases apart. Only
  // an actual screenshot comparison catches the cursor bar painting on top
  // of the modal (confirmed while writing this test: reverting the z-index
  // fix reproduces a visible orange line through the modal, ~300 pixels
  // different from this baseline).
  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("modal-layering-connection-modal.png");
  }
});
