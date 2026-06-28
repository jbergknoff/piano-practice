import { expect, test } from "@playwright/test";
import { audioContextMockInitScript } from "./mocks/audio-context";
import { advanceAudioTime, loadFile, mockCryptoSubtle } from "./helpers";

// The ?demo=1 profiling harness. Unlike the other specs, this exercises the
// app's OWN fake Bluetooth (installed by main.tsx for ?demo=1) rather than the
// test bluetooth mock, plus the simulated-performance feeder in PracticeScreen.
test("demo mode auto-selects Playalong and feeds a simulated performance", async ({
  page,
}) => {
  await page.addInitScript(audioContextMockInitScript());
  await mockCryptoSubtle(page);
  // Disable count-in so Play → waiting-for-note and the feeder's kickoff begins
  // playback (the count-in-on path begins playback on its own).
  await page.addInitScript(() => {
    localStorage.setItem(
      "piano-practice:preferences",
      JSON.stringify({
        playalongPlayMusic: true,
        playalongMetronome: false,
        playalongCountIn: false,
      }),
    );
  });

  await page.goto("/?demo=1");
  await loadFile(page, "rondo-alla-turca-clip.mxl");

  // The DEMO badge is visible and Playalong is auto-selected without hardware.
  await expect(page.getByText("Demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Playalong" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 5000 },
  );

  // Start the run, then advance the fake audio clock so the feeder fires notes.
  await page.getByTitle("Play").click();
  for (let i = 0; i < 8; i++) {
    await advanceAudioTime(page, 0.5);
    await page.waitForTimeout(60);
  }

  // The simulated presses produce player markers (one per press) and green
  // notehead highlights (matched notes) — the real Playalong render load.
  expect(await page.locator("[data-player-marker]").count()).toBeGreaterThan(3);
  expect(await page.locator("[data-color-id]").count()).toBeGreaterThan(3);
});
