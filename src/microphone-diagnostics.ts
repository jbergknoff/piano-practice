import { CircularBuffer } from "../lib/circular-buffer";

// At ~150 ms per captured frame, 40 frames covers ~6 seconds — enough to play a
// note or two and capture why detection did or didn't fire.
export const MICROPHONE_DIAGNOSTICS_MAX = 40;

export interface MicrophonePeakDiagnostic {
  /** Interpolated peak frequency in Hz. */
  frequency: number;
  /** Peak magnitude in dB (getFloatFrequencyData scale). */
  magnitudeDb: number;
  /** How far the peak rises above the noise floor (the prominence gate). */
  prominenceDb: number;
  /** Nearest MIDI note. */
  note: number;
  /** Signed deviation from that note's center, in cents. */
  centsOff: number;
  /** Whether this peak's note survived the full detection pipeline this frame. */
  accepted: boolean;
}

export interface MicrophoneFrameDiagnostic {
  /** Wall-clock timestamp (Date.now()). */
  t: number;
  /** Median in-band magnitude — the noise floor prominence is measured against. */
  noiseFloorDb: number;
  /** Candidate peaks (captured permissively so rejected ones are visible too). */
  peaks: MicrophonePeakDiagnostic[];
  /** Notes that passed peaksToMidiNotes this frame. */
  detected: number[];
  /** Notes currently sounding after the on/off debounce tracker. */
  on: number[];
}

export function newMicrophoneDiagnosticsBuffer(): CircularBuffer<MicrophoneFrameDiagnostic> {
  return new CircularBuffer<MicrophoneFrameDiagnostic>(
    MICROPHONE_DIAGNOSTICS_MAX,
  );
}
