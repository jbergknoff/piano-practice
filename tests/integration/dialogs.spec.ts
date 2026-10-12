import { expect, test } from "@playwright/test";
import { loadFile, mockCrypto } from "./helpers";

// Modals, drawers and the context menu are native <dialog>s (Modal, Drawer,
// ContextMenu). These pin down the behaviour the platform now provides, which
// the old hand-built versions got wrong: Escape used to be handled on backdrop
// <div>s that never receive keydown, so it closed almost nothing.

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await page.goto("/");
  await loadFile(page, "simple-grand-piano.musicxml");
});

const pieceInfo = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Piece info" });

async function openPieceInfo(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /simple grand piano/i }).click();
  await expect(pieceInfo(page)).toBeVisible();
}

test("Escape closes a modal", async ({ page }) => {
  await openPieceInfo(page);
  await page.keyboard.press("Escape");
  await expect(pieceInfo(page)).toHaveCount(0);
});

test("a click on the backdrop closes a modal; a click inside does not", async ({
  page,
}) => {
  await openPieceInfo(page);
  await pieceInfo(page).getByText("Time signature").click();
  await expect(pieceInfo(page)).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(pieceInfo(page)).toHaveCount(0);
});

test("a drag from inside a modal released on the backdrop does not close it", async ({
  page,
}) => {
  await openPieceInfo(page);
  const box = await pieceInfo(page).boundingBox();
  if (!box) {
    throw new Error("piece info modal has no box");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await expect(pieceInfo(page)).toBeVisible();
});

test("Escape closes a drawer", async ({ page }) => {
  await page.getByTitle("Settings").click();
  const drawer = page.getByRole("dialog", { name: "Settings" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("the context menu stays open after the right-click that opens it, and Escape closes it", async ({
  page,
}) => {
  // Chrome fires contextmenu while the button is still down, so the menu
  // opens mid-click; the rest of that click must not close it again.
  await page.locator("svg[role='img']").click({ button: "right" });
  const item = page.getByRole("button", { name: "Move cursor to here" });
  await expect(item).toBeVisible();
  await page.waitForTimeout(100);
  await expect(item).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);
});

test("a click outside the context menu closes it without pressing what is underneath", async ({
  page,
}) => {
  const play = page.getByTitle("Play");
  const playBox = await play.boundingBox();
  if (!playBox) {
    throw new Error("Play button has no box");
  }
  await page.locator("svg[role='img']").click({ button: "right" });
  const item = page.getByRole("button", { name: "Move cursor to here" });
  await expect(item).toBeVisible();

  // Click exactly where the Play button is. The menu's backdrop takes the
  // click, so the menu closes and playback does not start.
  await page.mouse.click(
    playBox.x + playBox.width / 2,
    playBox.y + playBox.height / 2,
  );
  await expect(item).toHaveCount(0);
  await expect(page.getByTitle("Play")).toBeVisible();
  await expect(page.getByTitle("Pause")).toHaveCount(0);
});

test("a right-click outside the context menu closes it", async ({ page }) => {
  await page.locator("svg[role='img']").click({ button: "right" });
  const item = page.getByRole("button", { name: "Move cursor to here" });
  await expect(item).toBeVisible();
  await page.mouse.click(10, 380, { button: "right" });
  await expect(item).toHaveCount(0);
});

test("a drawer slides out before it closes", async ({ page }) => {
  // Closing must slide the panel away first and only then close() the dialog:
  // un-inerting the page restyles everything, and doing that before the slide
  // made the slide-out start late on a phone.
  await page.getByTitle("Settings").click();
  const drawer = page.getByRole("dialog", { name: "Settings" });
  await expect(drawer).toHaveAttribute("data-shown", "");
  await page.getByRole("button", { name: "Close settings" }).click();
  const midSlide = await drawer.evaluate((element) => ({
    open: (element as HTMLDialogElement).open,
    shown: element.hasAttribute("data-shown"),
    sliding: element.getAnimations().length > 0,
  }));
  expect(midSlide).toEqual({ open: true, shown: false, sliding: true });
  await expect(drawer).toBeHidden();
});

test("with reduced motion a drawer opens and closes without sliding", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTitle("Settings").click();
  const drawer = page.getByRole("dialog", { name: "Settings" });
  await expect(drawer).toHaveAttribute("data-shown", "");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(drawer).toBeHidden();
});
