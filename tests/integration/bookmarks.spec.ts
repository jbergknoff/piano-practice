import { expect, test } from "@playwright/test";
import { loadFile, mockCrypto } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await page.goto("/");
});

// Screenshot baselines are generated inside the Docker playwright image; skip
// pixel comparison outside it (same guard the other visual specs use).
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

// simple-grand-piano.musicxml has 8 measures.
test("creating a bookmark via the drawer's + button with explicit bounds", async ({
  page,
}) => {
  await loadFile(page, "simple-grand-piano.musicxml");

  await page.getByTitle("Select range").click();
  await expect(page.getByText("Bookmarks", { exact: true })).toBeVisible();
  await expect(page.getByText("No bookmarks yet")).toBeVisible();

  const newButton = page.getByTitle("New bookmark");
  await expect(newButton).toBeVisible();
  if (screenshotsEnabled) {
    await expect(page).toHaveScreenshot("bookmarks-drawer-empty.png");
  }
  await newButton.click();

  // Modal opens with editable From/To bounds (not a static label),
  // defaulting to the whole piece since no focus range is active.
  await expect(page.getByText("Bookmark this range")).toBeVisible();
  const fromInput = page.locator("label", { hasText: "From" }).locator("input");
  const toInput = page.locator("label", { hasText: "To" }).locator("input");
  await expect(fromInput).toHaveValue("1");
  await expect(toInput).toHaveValue("8");
  if (screenshotsEnabled) {
    await expect(page).toHaveScreenshot("bookmarks-modal-default-bounds.png");
  }

  const nameInput = page.getByPlaceholder("e.g. Tricky run");
  const saveButton = page.getByRole("button", { name: "Save" });

  // Invalid bounds (from > to) disable Save.
  await fromInput.fill("7");
  await toInput.fill("3");
  await nameInput.fill("Tricky run");
  await expect(saveButton).toBeDisabled();

  // Out-of-range bounds (to > totalMeasures) also disable Save.
  await fromInput.fill("1");
  await toInput.fill("99");
  await expect(saveButton).toBeDisabled();

  // Valid bounds enable Save; saving closes the modal.
  await fromInput.fill("3");
  await toInput.fill("7");
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText("Bookmark this range")).toHaveCount(0);

  // The new bookmark appears in the Bookmarks list with the correct bounds, and
  // saving it also makes it the active focus range immediately (matching
  // whatever bounds were just saved, not left on "Whole piece").
  await page.getByTitle("Select range").click();
  const bookmarkButton = page.getByRole("button", { name: "Tricky run" });
  await expect(bookmarkButton).toBeVisible();
  await expect(bookmarkButton.getByText("mm. 3–7")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Whole piece" }),
  ).toHaveAttribute("aria-pressed", "false");
  if (screenshotsEnabled) {
    await expect(page).toHaveScreenshot("bookmarks-drawer-with-range.png");
  }
});

test("context menu offers Rename (not Edit) for an already-bookmarked range, and Rename doesn't expose bounds fields", async ({
  page,
}) => {
  await loadFile(page, "simple-grand-piano.musicxml");

  const container = page.getByTestId("sheet-music-scroll-container");
  // Position chosen to land inside a measure body, clear of the focus
  // overlay's drag handles (which sit right at the measure boundaries and
  // would otherwise swallow the right-click).
  const clickPosition = { x: 750, y: 100 };

  await container.click({ button: "right", position: clickPosition });
  await page.getByRole("button", { name: /Focus measure/ }).click();

  // Not yet named: the option reads "Bookmark this range".
  await container.click({ button: "right", position: clickPosition });
  await expect(
    page.getByRole("button", { name: "Bookmark this range" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bookmark this range" }).click();
  await page.getByPlaceholder("e.g. Tricky run").fill("My Range");
  await page.getByRole("button", { name: "Save" }).click();

  // Now named: the option reads Rename "My Range", not Edit "My Range".
  await container.click({ button: "right", position: clickPosition });
  await expect(page.getByText("Edit “My Range”")).toHaveCount(0);
  const renameOption = page.getByRole("button", {
    name: "Rename “My Range”",
  });
  await expect(renameOption).toBeVisible();
  if (screenshotsEnabled) {
    await expect(page).toHaveScreenshot("bookmarks-context-menu-rename.png");
  }

  // The rename flow only offers the name field — no From/To bounds, unlike
  // the drawer's "New bookmark" creation flow.
  await renameOption.click();
  await expect(page.getByText("Rename bookmark")).toBeVisible();
  await expect(page.locator("label", { hasText: "From" })).toHaveCount(0);
  await expect(page.locator("label", { hasText: "To" })).toHaveCount(0);
  if (screenshotsEnabled) {
    await expect(page).toHaveScreenshot("bookmarks-rename-modal.png");
  }
});

test("widening the bounds while bookmarking a focused range updates the active focus to match", async ({
  page,
}) => {
  await loadFile(page, "simple-grand-piano.musicxml");

  const container = page.getByTestId("sheet-music-scroll-container");
  const clickPosition = { x: 750, y: 100 };
  const focusRect = page.locator("svg[role='img'] > rect");

  await container.click({ button: "right", position: clickPosition });
  await page.getByRole("button", { name: /Focus measure/ }).click();
  const singleMeasureWidth = await focusRect.getAttribute("width");

  // Open "Bookmark this range": defaults to the single focused measure.
  await container.click({ button: "right", position: clickPosition });
  await page.getByRole("button", { name: "Bookmark this range" }).click();
  const fromInput = page.locator("label", { hasText: "From" }).locator("input");
  const toInput = page.locator("label", { hasText: "To" }).locator("input");
  const focusedMeasure = Number(await fromInput.inputValue());
  await expect(toInput).toHaveValue(String(focusedMeasure));

  // Widen the range by 2 measures beyond what was focused, and save.
  const widenedTo = Math.min(focusedMeasure + 2, 8);
  await toInput.fill(String(widenedTo));
  await page.getByPlaceholder("e.g. Tricky run").fill("Widened");
  const saveButton = page.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText("Bookmark this range")).toHaveCount(0);

  // The active focus range (the sheet music's orange overlay) should now
  // match the widened bounds just saved, not the original single measure.
  const widenedWidth = await focusRect.getAttribute("width");
  expect(Number(widenedWidth)).toBeGreaterThan(Number(singleMeasureWidth));

  // The drawer's bookmark list confirms the same widened bounds.
  await page.getByTitle("Select range").click();
  const bookmarkButton = page.getByRole("button", { name: "Widened" });
  await expect(
    bookmarkButton.getByText(`mm. ${focusedMeasure}–${widenedTo}`),
  ).toBeVisible();
});
