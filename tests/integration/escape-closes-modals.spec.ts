import { expect, test } from "@playwright/test";
import {
  installMocks,
  loadFile,
  mockCrypto,
  waitForMockBluetoothConnected,
} from "./helpers";

// Escape used to be handled by an onKeyDown on each modal's backdrop, which
// never fires: keydown goes to the focused element and bubbles through its
// ancestors, and the backdrop is neither. Modals now listen on the document
// (useEscapeKey).

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await installMocks(page);
  await page.goto("/");
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
});

test("Escape closes the piece info modal", async ({ page }) => {
  await page.getByRole("button", { name: /c major melody/i }).click();
  await expect(page.getByText("Time signature")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Time signature")).toHaveCount(0);
});

test("Escape closes the help modal", async ({ page }) => {
  await page.getByRole("button", { name: "Help" }).click();
  const tab = page.getByRole("button", { name: "About" });
  await expect(tab).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tab).toHaveCount(0);
});
