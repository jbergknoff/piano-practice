import { expect, test } from "@playwright/test";
import { loadFile, mockCrypto } from "./helpers";

// The shared button classes in src/styles.css carry states inline styles
// couldn't: a keyboard focus ring, hover, and a dimmed :disabled primary.
// The screenshot specs never exercise those states, so check them directly.

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await page.goto("/");
  await loadFile(page, "simple-grand-piano.musicxml");
});

const ACCENT = "rgb(224, 138, 62)";

test("keyboard focus shows a ring on a button; a mouse press doesn't", async ({
  page,
}) => {
  const settings = page.getByTitle("Settings");
  await settings.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(settings).toBeFocused();
  await expect(settings).toHaveCSS("outline-style", "solid");
  await expect(settings).toHaveCSS("outline-color", ACCENT);

  const open = page.getByTitle("Open file");
  await open.hover();
  await page.mouse.down();
  await expect(open).toBeFocused();
  await expect(open).toHaveCSS("outline-style", "none");
  await page.mouse.up();
});

test("a corner button lightens on hover", async ({ page }) => {
  const settings = page.getByTitle("Settings");
  // --color-panel at rest; --color-panel-solid (#FFF7E5) under the pointer.
  await expect(settings).toHaveCSS(
    "background-color",
    "rgba(255, 250, 238, 0.78)",
  );
  await settings.hover();
  await expect(settings).toHaveCSS("background-color", "rgb(255, 247, 229)");
});

test("a disabled primary action button dims; its secondary doesn't", async ({
  page,
}) => {
  await page.locator("svg[role='img']").click({ button: "right" });
  await page.getByRole("button", { name: "Jump to measure…" }).click();
  const input = page.locator('input[type="number"]');
  await expect(input).toBeFocused();

  const go = page.getByRole("button", { name: "Go" });
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(go).toHaveCSS("background-color", ACCENT);
  await expect(go).toHaveCSS("opacity", "1");

  await input.fill("");
  await expect(go).toBeDisabled();
  await expect(go).toHaveCSS("opacity", "0.4");
  await expect(cancel).toHaveCSS("opacity", "1");
});
