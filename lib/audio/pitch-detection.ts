// Pure, framework-agnostic pitch detection over an FFT magnitude spectrum.
//
// The pipeline is: an `AnalyserNode` produces a frequency-magnitude array; we
// find spectral peaks (local maxima above a threshold, with parabolic sub-bin
// interpolation), then map those peaks to MIDI note numbers while suppressing
// the harmonic overtones a single piano note inevitably produces.
//
// Nothing here touches the Web Audio API or Preact — it operates on plain
// arrays so it can be unit-tested deterministically under `bun test`.

// Equal-tempered A440 tuning. This is the inverse of the synthesis formula in
// lib/midi/midi-player.ts (`440 * 2 ** ((midiNote - 69) / 12)`).
export function midiNoteToFrequency(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

// Returns a fractional MIDI note number (not rounded), so callers can inspect
// how far a frequency sits from a semitone center.
export function frequencyToMidiNote(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

// Rounds a frequency to the nearest semitone and reports the signed deviation
// in cents (-50..+50), so callers can gate on tuning accuracy.
export function nearestMidiNote(frequency: number): {
  midiNote: number;
  centsOff: number;
} {
  const fractional = frequencyToMidiNote(frequency);
  const midiNote = Math.round(fractional);
  const centsOff = (fractional - midiNote) * 100;
  return { midiNote, centsOff };
}

export interface SpectralPeak {
  // Interpolated (fractional) bin index of the peak.
  binIndex: number;
  // Interpolated peak frequency in Hz.
  frequency: number;
  // Interpolated peak magnitude, in the same units as the input array
  // (dB when fed `getFloatFrequencyData` output).
  magnitude: number;
}

export interface FindSpectralPeaksOptions {
  sampleRate: number;
  fftSize: number;
  // Ignore bins quieter than this. For dB input (getFloatFrequencyData),
  // something like -70 works as a noise gate.
  thresholdDb: number;
  // Require each peak to rise at least this many dB above the band's noise
  // floor (the median bin magnitude). Tonal sounds (piano notes) produce sharp
  // peaks far above the floor; broadband sounds (speech, key clicks) raise the
  // whole floor without standing out, so this rejects them. 0 disables it.
  minProminenceDb?: number;
  // Frequency window to consider. Defaults span the piano's fundamental range
  // up through the low harmonics we care about.
  minFrequency?: number;
  maxFrequency?: number;
  // Keep at most this many of the strongest peaks.
  maxPeaks?: number;
}

// Noise floor of the in-band spectrum = the median bin magnitude. Robust to
// the handful of tonal peaks that sit well above it. Shared by findSpectralPeaks
// (for its prominence gate) and the microphone diagnostics.
export function computeNoiseFloorDb(
  magnitudes: Float32Array | number[],
  options: {
    sampleRate: number;
    fftSize: number;
    minFrequency?: number;
    maxFrequency?: number;
  },
): number {
  const {
    sampleRate,
    fftSize,
    minFrequency = 27.5,
    maxFrequency = 5000,
  } = options;
  const binToFrequency = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(minFrequency / binToFrequency));
  const maxBin = Math.min(
    magnitudes.length - 2,
    Math.ceil(maxFrequency / binToFrequency),
  );
  if (maxBin < minBin) {
    return Number.NEGATIVE_INFINITY;
  }
  const band: number[] = [];
  for (let bin = minBin; bin <= maxBin; bin++) {
    band.push(magnitudes[bin]);
  }
  band.sort((a, b) => a - b);
  return band[Math.floor(band.length / 2)];
}

// Finds local maxima in an FFT magnitude array. Each returned peak is refined
// with parabolic interpolation across its two neighbours, which recovers most
// of the frequency resolution lost to coarse bin spacing (at 44.1 kHz / 8192
// bins, ~5.4 Hz/bin, which is ~80 cents near A2).
export function findSpectralPeaks(
  magnitudes: Float32Array | number[],
  options: FindSpectralPeaksOptions,
): SpectralPeak[] {
  const {
    sampleRate,
    fftSize,
    thresholdDb,
    minProminenceDb = 0,
    minFrequency = 27.5,
    maxFrequency = 5000,
    maxPeaks = 12,
  } = options;

  const binToFrequency = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(minFrequency / binToFrequency));
  const maxBin = Math.min(
    magnitudes.length - 2,
    Math.ceil(maxFrequency / binToFrequency),
  );

  let floorThreshold = thresholdDb;
  if (minProminenceDb > 0 && maxBin >= minBin) {
    const noiseFloor = computeNoiseFloorDb(magnitudes, {
      sampleRate,
      fftSize,
      minFrequency,
      maxFrequency,
    });
    floorThreshold = Math.max(thresholdDb, noiseFloor + minProminenceDb);
  }

  const peaks: SpectralPeak[] = [];
  for (let bin = minBin; bin <= maxBin; bin++) {
    const value = magnitudes[bin];
    if (value < floorThreshold) {
      continue;
    }
    const left = magnitudes[bin - 1];
    const right = magnitudes[bin + 1];
    // Strict local maximum.
    if (value <= left || value < right) {
      continue;
    }
    // Parabolic interpolation: vertex offset of the parabola through the three
    // points. Guard the degenerate (flat) denominator.
    const denominator = left - 2 * value + right;
    const offset = denominator === 0 ? 0 : (0.5 * (left - right)) / denominator;
    const interpolatedBin = bin + offset;
    peaks.push({
      binIndex: interpolatedBin,
      frequency: interpolatedBin * binToFrequency,
      magnitude: value - 0.25 * (left - right) * offset,
    });
  }

  peaks.sort((a, b) => b.magnitude - a.magnitude);
  return peaks.slice(0, maxPeaks);
}

export interface PeaksToMidiNotesOptions {
  // How close (in cents) a peak must sit to a semitone center to count.
  centsTolerance?: number;
  // How close (in cents) a higher peak must sit to an integer multiple of a
  // candidate fundamental to be treated as that note's harmonic.
  harmonicToleranceCents?: number;
  // Drop candidate fundamentals quieter than (strongest peak − this many dB) —
  // rejects noise-floor wobble. Magnitudes are assumed to be in dB.
  maxMagnitudeBelowStrongestDb?: number;
  // A higher peak is only treated as a harmonic if it is not more than this
  // many dB louder than the candidate fundamental (a much louder peak is more
  // likely its own fundamental).
  harmonicMaxExcessDb?: number;
}

// Maps spectral peaks to a set of MIDI note numbers, suppressing harmonics.
//
// A single piano note at fundamental f produces strong peaks at 2f, 3f, 4f...
// which naively map to phantom notes (an octave up, an octave+fifth, etc.). We
// walk peaks low-to-high, treat each surviving peak as a fundamental, and
// remove any higher peak that lands near an integer multiple of it — unless
// that higher peak is dramatically louder (which would indicate it is itself a
// fundamental whose own sub-octave is just noise).
//
// This intentionally under-detects genuine octave/fifth chords (a real C4
// sharing C3's 2nd harmonic may be suppressed). For Wait mode, under-detection
// is safer than phantom notes.
export function peaksToMidiNotes(
  peaks: SpectralPeak[],
  options: PeaksToMidiNotesOptions = {},
): Set<number> {
  const {
    centsTolerance = 35,
    harmonicToleranceCents = 40,
    maxMagnitudeBelowStrongestDb = 40,
    harmonicMaxExcessDb = 6,
  } = options;

  if (peaks.length === 0) {
    return new Set();
  }

  const strongestMagnitude = Math.max(...peaks.map((peak) => peak.magnitude));
  const ascending = [...peaks].sort((a, b) => a.frequency - b.frequency);
  const suppressed = new Set<number>();
  const result = new Set<number>();

  for (let i = 0; i < ascending.length; i++) {
    if (suppressed.has(i)) {
      continue;
    }
    const fundamental = ascending[i];
    // Mark higher peaks that are harmonics of this fundamental.
    for (let j = i + 1; j < ascending.length; j++) {
      if (suppressed.has(j)) {
        continue;
      }
      const ratio = ascending[j].frequency / fundamental.frequency;
      const nearestMultiple = Math.round(ratio);
      if (nearestMultiple < 2 || nearestMultiple > 6) {
        continue;
      }
      const centsFromMultiple = Math.abs(
        1200 * Math.log2(ratio / nearestMultiple),
      );
      if (centsFromMultiple > harmonicToleranceCents) {
        continue;
      }
      // A peak much louder than the candidate fundamental is unlikely to be a
      // mere overtone of it; leave it as its own fundamental.
      if (
        ascending[j].magnitude >
        fundamental.magnitude + harmonicMaxExcessDb
      ) {
        continue;
      }
      suppressed.add(j);
    }

    // Reject candidate fundamentals near the noise floor.
    if (
      fundamental.magnitude <
      strongestMagnitude - maxMagnitudeBelowStrongestDb
    ) {
      continue;
    }
    const { midiNote, centsOff } = nearestMidiNote(fundamental.frequency);
    if (Math.abs(centsOff) <= centsTolerance) {
      result.add(midiNote);
    }
  }

  return result;
}
