import { expect, test } from "@playwright/test";
import { loadFile, mockCrypto } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await page.goto("/");
});

// simple-grand-piano.musicxml has 8 measures.
test("creating a custom range via the drawer's + button with explicit bounds", async ({
  page,
}) => {
  await loadFile(page, "simple-grand-piano.musicxml");

  await page.getByTitle("Select range").click();
  await expect(page.getByText("Custom", { exact: true })).toBeVisible();
  await expect(page.getByText("No custom ranges yet")).toBeVisible();

  const newButton = page.getByTitle("New custom range");
  await expect(newButton).toBeVisible();
  await newButton.click();

  // Modal opens with editable From/To bounds (not a static label),
  // defaulting to the whole piece since no focus range is active.
  await expect(page.getByText("Name this range")).toBeVisible();
  const fromInput = page.locator("label", { hasText: "From" }).locator("input");
  const toInput = page.locator("label", { hasText: "To" }).locator("input");
  await expect(fromInput).toHaveValue("1");
  await expect(toInput).toHaveValue("8");

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
  await expect(page.getByText("Name this range")).toHaveCount(0);

  // The new range appears in the Custom list with the correct bounds and can
  // be selected to set it as the active focus range.
  await page.getByTitle("Select range").click();
  const customButton = page.getByRole("button", { name: "Tricky run" });
  await expect(customButton).toBeVisible();
  await expect(customButton.getByText("mm. 3–7")).toBeVisible();

  await customButton.click();
  await page.getByTitle("Select range").click();
  await expect(
    page.getByRole("button", { name: "Whole piece" }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("context menu offers Rename (not Edit) for an already-named range, and Rename doesn't expose bounds fields", async ({
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

  // Not yet named: the option reads "Name this range".
  await container.click({ button: "right", position: clickPosition });
  await expect(
    page.getByRole("button", { name: "Name this range" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Name this range" }).click();
  await page.getByPlaceholder("e.g. Tricky run").fill("My Range");
  await page.getByRole("button", { name: "Save" }).click();

  // Now named: the option reads Rename "My Range", not Edit "My Range".
  await container.click({ button: "right", position: clickPosition });
  await expect(page.getByText("Edit “My Range”")).toHaveCount(0);
  const renameOption = page.getByRole("button", {
    name: "Rename “My Range”",
  });
  await expect(renameOption).toBeVisible();

  // The rename flow only offers the name field — no From/To bounds, unlike
  // the drawer's "New custom range" creation flow.
  await renameOption.click();
  await expect(page.getByText("Rename range")).toBeVisible();
  await expect(page.locator("label", { hasText: "From" })).toHaveCount(0);
  await expect(page.locator("label", { hasText: "To" })).toHaveCount(0);
});
