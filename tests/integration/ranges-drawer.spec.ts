import { expect, test } from "@playwright/test";
import { blockExternalFonts, loadFile, mockCryptoSubtle } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockExternalFonts(page);
  await mockCryptoSubtle(page);
  await page.goto("/");
});

test("repeat sections appear in the ranges drawer", async ({ page }) => {
  // two-section-repeat.musicxml has |: m1 m2 :| |: m3 m4 :|
  // After expansion: 8 measures.
  // Section A = expanded mm 1–2, Section B = expanded mm 5–6.
  await loadFile(page, "two-section-repeat.musicxml");

  await page.getByTitle("Select range").click();

  // The "Sections" group heading should appear.
  await expect(page.getByText("Sections", { exact: true })).toBeVisible();

  // Both section buttons should be present.
  const sectionA = page.getByRole("button", { name: "Section A" });
  const sectionB = page.getByRole("button", { name: "Section B" });
  await expect(sectionA).toBeVisible();
  await expect(sectionB).toBeVisible();

  // Sublabels scoped within their own button so the Q1 "mm. 1–2" label
  // doesn't cause a strict-mode collision.
  await expect(sectionA.getByText("mm. 1–2")).toBeVisible();
  await expect(sectionB.getByText("mm. 5–6")).toBeVisible();
});

test("clicking a section preset selects it as the active range", async ({
  page,
}) => {
  await loadFile(page, "two-section-repeat.musicxml");

  // Open the drawer and click Section B.
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "Section B" }).click();

  // Clicking a preset closes the drawer (CSS translateX, not display:none).
  // The "Select range" button always sets open=true, so clicking it re-opens
  // the drawer regardless of mid-animation state.
  await page.getByTitle("Select range").click();
  await expect(page.getByText("Sections", { exact: true })).toBeVisible();

  // Section B should now be active.
  await expect(
    page.getByRole("button", { name: "Section B" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Whole piece and Section A must not be active.
  await expect(
    page.getByRole("button", { name: "Whole piece" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Section A" }),
  ).toHaveAttribute("aria-pressed", "false");
});
