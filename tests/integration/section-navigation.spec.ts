import { expect, test } from "@playwright/test";
import {
  installMocks,
  loadFile,
  mockCrypto,
  sendNoteOff,
  sendNoteOn,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await installMocks(page);
  await page.goto("/");
});

// MIDI note numbers for c-major-melody.mid, measure 1.
const MEASURE_ONE = [64, 72, 76, 71]; // E4 C5 E5 B4

test("the wait-mode result modal steps to the next and previous section", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await page.getByRole("button", { name: "Wait" }).click();

  // Focus measure 1 only, so a playthrough completes after just 4 notes.
  await page.locator("svg[role='img']").click({ button: "right" });
  await page.getByRole("button", { name: "Jump to measure…" }).click();
  await page.locator('input[type="number"]').fill("1");
  await page.getByRole("button", { name: "Go" }).click();
  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  for (const note of MEASURE_ONE) {
    await sendNoteOn(page, note);
    await sendNoteOff(page, note);
    await page.waitForTimeout(120);
  }
  await expect(page.getByText("Measure 1 complete")).toBeVisible({
    timeout: 2_000,
  });

  // c-major-melody.mid is two measures long, so measure 1 alone is also the
  // "First half" preset — stepping stays within the halves series. Measure 1
  // is the start of the piece: there is a next section but no previous.
  const next = page.locator("[data-section-nav='next']");
  await expect(next).toHaveAttribute("aria-label", "Next: Second half");
  await expect(next).toBeEnabled();
  await expect(page.locator("[data-section-nav='previous']")).toBeDisabled();
  if (screenshotsEnabled) {
    await expect(page).toHaveScreenshot("section-navigation-result-modal.png");
  }

  await next.click();
  await expect(page.getByText("Measure 1 complete")).not.toBeVisible();
  // Wait mode restarts at the first wait point of the new range.
  await page.waitForFunction(() => {
    const ids = Array.from(document.querySelectorAll("[data-color-id]")).map(
      (element) => element.getAttribute("data-color-id") ?? "",
    );
    return ids.length > 0 && ids.every((id) => id.startsWith("p0-m2-"));
  });
});
