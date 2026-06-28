import { expect, test } from "@playwright/test";
import { audioContextMockInitScript } from "./mocks/audio-context";
import { advanceAudioTime, loadFile, mockCryptoSubtle } from "./helpers";

// The ?demo=1 profiling harness. Unlike the other specs, this exercises the
// app's OWN fake Bluetooth (installed by main.tsx for ?demo=1) rather than the
// test bluetooth mock, plus the self-contained DemoOverlay, whose "Play notes"
// button sprays random note events through the real dispatch path.
test("demo mode auto-selects Playalong and the overlay sprays notes", async ({
  page,
}) => {
  await page.addInitScript(audioContextMockInitScript());
  await mockCryptoSubtle(page);
  // Disable count-in so Play → waiting-for-note and the first sprayed note
  // kicks playback off.
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

  // Playalong is auto-selected without hardware, and the demo overlay is shown.
  await expect(page.getByRole("button", { name: "Playalong" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 5000 },
  );
  const playNotes = page.getByRole("button", { name: "Play notes", exact: true });
  await expect(playNotes).toBeVisible();

  // Start the run, then spray random notes; advance the clock so playback runs.
  await page.getByTitle("Play").click();
  await playNotes.click();
  for (let i = 0; i < 12; i++) {
    await advanceAudioTime(page, 0.3);
    await page.waitForTimeout(80);
  }

  // The sprayed presses produce player markers — the real Playalong render load.
  expect(await page.locator("[data-player-marker]").count()).toBeGreaterThan(5);
});
