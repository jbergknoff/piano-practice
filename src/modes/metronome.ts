import type { MetronomeTick } from "../../lib/midi/midi-player";

/**
 * The metronome's clicks for a whole piece: one per time-signature beat
 * (`4 / timeSigDen` quarter notes apart), restarting at every measure's actual
 * start beat so the downbeat always lands on the barline — including after a
 * pickup measure or any other irregular-length measure. Each tick's beat is
 * computed as `measureStart + k * unit` rather than accumulated, so it carries
 * no float drift.
 */
export function metronomeTicks(
  measureStartBeats: number[],
  totalBeats: number,
  timeSigDen: number,
): MetronomeTick[] {
  const unit = 4 / timeSigDen;
  const ticks: MetronomeTick[] = [];
  for (let index = 0; index < measureStartBeats.length; index++) {
    const start = measureStartBeats[index];
    const end = measureStartBeats[index + 1] ?? totalBeats;
    for (let k = 0; start + k * unit < end - 1e-6; k++) {
      ticks.push({ beat: start + k * unit, downbeat: k === 0 });
    }
  }
  return ticks;
}

/**
 * Sends a closed hi-hat on the GM percussion channel — the click used by the
 * metronome and count-in (accented on downbeats) and by wait mode's wrong-note
 * feedback (unaccented).
 */
export function sendHiHat(
  sendNote: (
    note: number,
    velocity: number,
    durationMs: number,
    channel?: number,
  ) => void,
  accented: boolean,
): void {
  // Channel 9 = GM percussion; note 42 = Closed Hi-Hat.
  sendNote(42, accented ? 80 : 55, 80, 9);
}
