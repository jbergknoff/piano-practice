import { expect, type Page, test } from "@playwright/test";

/**
 * Replace the fullscreen + orientation APIs with a recording stub that also
 * models the document's fullscreen state, so a spec can both assert what was
 * asked for and simulate fullscreen being taken away.
 *
 * Real fullscreen is deliberately not exercised: headless Chromium grants it,
 * but `screen.orientation.lock()` has nothing to lock on a desktop-class screen
 * and rejects, so the interesting assertion (we ask for landscape) would be
 * untestable against the real APIs.
 */
async function stubFullscreenApis(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    let fullscreenElement: Element | null = null;
    (window as unknown as { __fullscreenCalls: string[] }).__fullscreenCalls =
      calls;

    const notifyChange = () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    };

    // Defined on the prototypes rather than the instances, which do not yet
    // exist when an init script runs.
    Object.defineProperty(Document.prototype, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value(this: Element) {
        calls.push("request");
        fullscreenElement = this;
        notifyChange();
        return Promise.resolve();
      },
    });
    Object.defineProperty(Document.prototype, "exitFullscreen", {
      configurable: true,
      value() {
        calls.push("exit");
        fullscreenElement = null;
        notifyChange();
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

    // Android hands the file picker its own system activity, which drops the
    // page out of fullscreen behind the app's back.
    (window as unknown as { __dropFullscreen: () => void }).__dropFullscreen =
      () => {
        fullscreenElement = null;
        notifyChange();
      };
    // Returning to the page afterwards. Kept separate from the drop so a spec
    // can choose which of the two restore paths it is exercising.
    (window as unknown as { __returnToPage: () => void }).__returnToPage =
      () => {
        document.dispatchEvent(new Event("visibilitychange"));
      };
  });
}

function fullscreenCalls(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __fullscreenCalls: string[] }).__fullscreenCalls,
  );
}

/** Open the landing screen's file picker, which arms the fullscreen restore. */
async function openFilePicker(page: Page) {
  // A real click would hand the click to Playwright's file-chooser
  // interception; the click event itself — which is what the app listens for —
  // is identical either way.
  await page.locator('input[type="file"]').dispatchEvent("click");
}

/** A tap on empty background, well clear of the drop zone and corner buttons. */
async function tapBackground(page: Page) {
  await page.mouse.click(5, 5);
}

test("fullscreen button requests fullscreen and locks landscape", async ({
  page,
}) => {
  await stubFullscreenApis(page);
  await page.goto("/");

  await page.getByTitle("Fullscreen (landscape)").click();

  await expect
    .poll(() => fullscreenCalls(page))
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

test("fullscreen lost to the file picker is restored on return", async ({
  page,
}) => {
  await stubFullscreenApis(page);
  await page.goto("/");
  await page.getByTitle("Fullscreen (landscape)").click();

  await openFilePicker(page);
  await page.evaluate(() =>
    (window as unknown as { __dropFullscreen: () => void }).__dropFullscreen(),
  );
  await page.evaluate(() =>
    (window as unknown as { __returnToPage: () => void }).__returnToPage(),
  );

  await expect
    .poll(() => fullscreenCalls(page))
    .toEqual(["request", "lock:landscape", "request", "lock:landscape"]);
});

test("fullscreen lost to the file picker is restored on the next tap", async ({
  page,
}) => {
  // The path that matters on Android: `requestFullscreen` wants transient
  // activation, which coming back from another activity does not supply, so the
  // restore waits for the user's next tap to spend.
  await stubFullscreenApis(page);
  await page.goto("/");
  await page.getByTitle("Fullscreen (landscape)").click();

  await openFilePicker(page);
  await page.evaluate(() =>
    (window as unknown as { __dropFullscreen: () => void }).__dropFullscreen(),
  );
  await tapBackground(page);

  await expect
    .poll(() => fullscreenCalls(page))
    .toEqual(["request", "lock:landscape", "request", "lock:landscape"]);
});

test("a tap does not restore fullscreen the user left deliberately", async ({
  page,
}) => {
  await stubFullscreenApis(page);
  await page.goto("/");

  await page.getByTitle("Fullscreen (landscape)").click();
  await page.getByTitle("Exit fullscreen").click();
  await tapBackground(page);

  await expect
    .poll(() => fullscreenCalls(page))
    .toEqual(["request", "lock:landscape", "exit"]);
});

test("the fullscreen button still toggles once while a restore is armed", async ({
  page,
}) => {
  // A user who notices the drop and reaches for the button must not have the
  // armed restore racing that same tap.
  await stubFullscreenApis(page);
  await page.goto("/");
  await page.getByTitle("Fullscreen (landscape)").click();

  await openFilePicker(page);
  await page.evaluate(() =>
    (window as unknown as { __dropFullscreen: () => void }).__dropFullscreen(),
  );
  await page.getByTitle("Fullscreen (landscape)").click();

  await expect
    .poll(() => fullscreenCalls(page))
    .toEqual(["request", "lock:landscape", "request", "lock:landscape"]);
});
