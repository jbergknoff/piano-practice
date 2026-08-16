import { expect, test } from "@playwright/test";

/**
 * Replace the fullscreen + orientation APIs with recording stubs. Real
 * fullscreen is deliberately not exercised: headless Chromium grants it, but
 * `screen.orientation.lock()` has nothing to lock on a desktop-class screen and
 * rejects, so the interesting assertion (we ask for landscape) would be
 * untestable against the real APIs.
 */
async function stubFullscreenApis(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __fullscreenCalls: string[] }).__fullscreenCalls =
      calls;
    // Defined on the prototype rather than documentElement, which does not yet
    // exist when an init script runs.
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: () => {
        calls.push("request");
        return Promise.resolve();
      },
    });
    Object.defineProperty(screen.orientation, "lock", {
      configurable: true,
      value: (orientation: string) => {
        calls.push(`lock:${orientation}`);
        return Promise.resolve();
      },
    });
  });
}

test("fullscreen button requests fullscreen and locks landscape", async ({
  page,
}) => {
  await stubFullscreenApis(page);
  await page.goto("/");

  await page.getByTitle("Fullscreen (landscape)").click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __fullscreenCalls: string[] })
            .__fullscreenCalls,
      ),
    )
    .toEqual(["request", "lock:landscape"]);
});

test("fullscreen button is hidden where the API is unavailable", async ({
  page,
}) => {
  // iPhone Safari exposes no fullscreen API at all; the button must not render
  // rather than offering something that silently does nothing.
  // Chromium ships both the standard and the webkit-prefixed entry points, so
  // both have to go for this to look like a browser without the API.
  await page.addInitScript(() => {
    for (const name of ["requestFullscreen", "webkitRequestFullscreen"]) {
      Object.defineProperty(Element.prototype, name, {
        configurable: true,
        value: undefined,
      });
    }
  });
  await page.goto("/");

  // Wait for chrome that renders unconditionally, so absence is a real result
  // and not just an unrendered page.
  await expect(page.locator('input[type="file"]')).toBeAttached();
  await expect(page.getByTitle("Fullscreen (landscape)")).toHaveCount(0);
});
