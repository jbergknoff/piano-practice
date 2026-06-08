import { describe, expect, test } from "bun:test";
import {
  findSpectralPeaks,
  frequencyToMidiNote,
  midiNoteToFrequency,
  nearestMidiNote,
  peaksToMidiNotes,
  type SpectralPeak,
} from "./pitch-detection";

describe("midiNoteToFrequency", () => {
  test("A4 (69) is 440 Hz", () => {
    expect(midiNoteToFrequency(69)).toBeCloseTo(440, 5);
  });

  test("A3 (57) is 220 Hz", () => {
    expect(midiNoteToFrequency(57)).toBeCloseTo(220, 5);
  });

  test("middle C (60) is ~261.63 Hz", () => {
    expect(midiNoteToFrequency(60)).toBeCloseTo(261.63, 1);
  });
});

describe("frequencyToMidiNote", () => {
  test("round-trips with midiNoteToFrequency", () => {
    for (const note of [21, 33, 48, 60, 69, 84, 108]) {
      expect(frequencyToMidiNote(midiNoteToFrequency(note))).toBeCloseTo(
        note,
        5,
      );
    }
  });
});

describe("nearestMidiNote", () => {
  test("440 Hz is A4 with ~0 cents off", () => {
    const { midiNote, centsOff } = nearestMidiNote(440);
    expect(midiNote).toBe(69);
    expect(centsOff).toBeCloseTo(0, 5);
  });

  test("445 Hz is A4, sharp by ~19.6 cents", () => {
    const { midiNote, centsOff } = nearestMidiNote(445);
    expect(midiNote).toBe(69);
    expect(centsOff).toBeCloseTo(19.56, 1);
  });

  test("a frequency a quarter-tone above A4 rounds up and reports ~ -50 cents", () => {
    // +50 cents above 440 == one quarter tone.
    const quarterToneAbove = 440 * 2 ** (50 / 1200);
    const { midiNote, centsOff } = nearestMidiNote(quarterToneAbove);
    expect(midiNote).toBe(70);
    expect(centsOff).toBeCloseTo(-50, 0);
  });
});

describe("findSpectralPeaks", () => {
  const sampleRate = 44100;
  const fftSize = 8192;
  const binToFrequency = sampleRate / fftSize;

  test("returns only local maxima above the threshold", () => {
    const magnitudes = new Float32Array(fftSize / 2).fill(-120);
    // Bump 1: a clear peak around bin 100.
    magnitudes[99] = -80;
    magnitudes[100] = -60;
    magnitudes[101] = -82;
    // Bump 2: another around bin 200.
    magnitudes[199] = -75;
    magnitudes[200] = -55;
    magnitudes[201] = -77;
    // A sub-threshold bump around bin 300 — should be ignored.
    magnitudes[299] = -100;
    magnitudes[300] = -90;
    magnitudes[301] = -101;

    const peaks = findSpectralPeaks(magnitudes, {
      sampleRate,
      fftSize,
      thresholdDb: -70,
    });

    expect(peaks.length).toBe(2);
    const bins = peaks
      .map((peak) => Math.round(peak.binIndex))
      .sort((a, b) => a - b);
    expect(bins).toEqual([100, 200]);
  });

  test("parabolic interpolation centers a symmetric triangle on the middle bin", () => {
    const magnitudes = new Float32Array(fftSize / 2).fill(-120);
    magnitudes[149] = -70;
    magnitudes[150] = -50;
    magnitudes[151] = -70;

    const [peak] = findSpectralPeaks(magnitudes, {
      sampleRate,
      fftSize,
      thresholdDb: -90,
    });

    expect(peak.binIndex).toBeCloseTo(150, 5);
    expect(peak.frequency).toBeCloseTo(150 * binToFrequency, 3);
  });

  test("minProminenceDb rejects peaks that don't rise above the noise floor", () => {
    // A raised, broadband floor (like speech/clicks) at -50 across the band,
    // with two local maxima: one barely above the floor, one well above.
    const magnitudes = new Float32Array(fftSize / 2).fill(-50);
    magnitudes[120] = -44; // only 6 dB above the floor → not prominent
    magnitudes[121] = -50;
    magnitudes[119] = -50;
    magnitudes[240] = -18; // 32 dB above the floor → clearly prominent
    magnitudes[241] = -50;
    magnitudes[239] = -50;

    const peaks = findSpectralPeaks(magnitudes, {
      sampleRate,
      fftSize,
      thresholdDb: -90,
      minProminenceDb: 15,
    });

    expect(peaks.map((peak) => Math.round(peak.binIndex))).toEqual([240]);
  });

  test("respects the frequency window and maxPeaks cap", () => {
    const magnitudes = new Float32Array(fftSize / 2).fill(-120);
    // Three peaks of decreasing strength.
    magnitudes[100] = -50;
    magnitudes[101] = -120;
    magnitudes[200] = -55;
    magnitudes[201] = -120;
    magnitudes[300] = -60;
    magnitudes[301] = -120;
    magnitudes[99] = -120;
    magnitudes[199] = -120;
    magnitudes[299] = -120;

    const capped = findSpectralPeaks(magnitudes, {
      sampleRate,
      fftSize,
      thresholdDb: -90,
      maxPeaks: 2,
    });
    expect(capped.length).toBe(2);
    // The two strongest survive.
    const bins = capped
      .map((peak) => Math.round(peak.binIndex))
      .sort((a, b) => a - b);
    expect(bins).toEqual([100, 200]);

    const windowed = findSpectralPeaks(magnitudes, {
      sampleRate,
      fftSize,
      thresholdDb: -90,
      minFrequency: 150 * binToFrequency,
      maxFrequency: 250 * binToFrequency,
    });
    expect(windowed.map((peak) => Math.round(peak.binIndex))).toEqual([200]);
  });
});

describe("peaksToMidiNotes", () => {
  function peakAt(frequency: number, magnitude: number): SpectralPeak {
    return { binIndex: 0, frequency, magnitude };
  }

  test("suppresses harmonics of a single fundamental", () => {
    const fundamental = midiNoteToFrequency(60); // C4
    const peaks = [
      peakAt(fundamental, -40),
      peakAt(fundamental * 2, -50),
      peakAt(fundamental * 3, -55),
      peakAt(fundamental * 4, -60),
    ];
    expect([...peaksToMidiNotes(peaks)]).toEqual([60]);
  });

  test("keeps a genuine non-harmonic interval", () => {
    // C4 + F#4 — a tritone, no near-integer frequency ratio.
    const peaks = [
      peakAt(midiNoteToFrequency(60), -40),
      peakAt(midiNoteToFrequency(66), -42),
    ];
    expect([...peaksToMidiNotes(peaks)].sort((a, b) => a - b)).toEqual([
      60, 66,
    ]);
  });

  test("drops peaks below the magnitude ratio floor", () => {
    const peaks = [
      peakAt(midiNoteToFrequency(60), -30),
      // Non-harmonic but very weak relative to the strongest.
      peakAt(midiNoteToFrequency(66), -95),
    ];
    expect([...peaksToMidiNotes(peaks)]).toEqual([60]);
  });

  test("returns an empty set for no peaks", () => {
    expect(peaksToMidiNotes([]).size).toBe(0);
  });
});
