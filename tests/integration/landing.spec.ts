import { expect, test } from "@playwright/test";
import { blockExternalFonts } from "./helpers";

test("landing screen shows file upload UI", async ({ page }) => {
  await blockExternalFonts(page);
  await page.goto("/");

  // The hidden file input must exist and accept all supported formats
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeAttached();
  const accept = await fileInput.getAttribute("accept");
  expect(accept).toContain(".mid");
  expect(accept).toContain(".musicxml");
  expect(accept).toContain(".mxl");
});
