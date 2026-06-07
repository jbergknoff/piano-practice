import { useEffect, useRef, useState } from "preact/hooks";
import {
  createNoteTracker,
  type NoteTrackerState,
  trackFrame,
} from "../../lib/audio/note-tracker";
import {
  findSpectralPeaks,
  nearestMidiNote,
  peaksToMidiNotes,
} from "../../lib/audio/pitch-detection";

export type MicrophoneStatus = "idle" | "requesting" | "active" | "error";

export interface MicrophoneState {
  status: MicrophoneStatus;
  error: string | null;
  // MIDI notes currently sounding, for the live readout. Updated only when the
  // set changes, to avoid a re-render every animation frame.
  detectedNotes: number[];
  // Triggers the browser microphone-permission prompt and starts detection.
  enable: () => Promise<void>;
  // Stops detection and releases the microphone.
  disable: () => void;
}

// fftSize trades frequency resolution against latency. At 44.1 kHz, 8192 bins
// give ~5.4 Hz/bin — adequate from the mid register up once combined with the
// parabolic interpolation in findSpectralPeaks. The bottom octave stays
// unreliable (a known limitation).
const FFT_SIZE = 8192;
const THRESHOLD_DB = -70;
const MIN_FREQUENCY = 27.5; // A0
const MAX_FREQUENCY = 5000;
// dB range mapped onto MIDI velocity 1..127.
const VELOCITY_MIN_DB = -60;
const VELOCITY_MAX_DB = -20;

function magnitudeToVelocity(magnitudeDb: number): number {
  const clamped = Math.min(
    VELOCITY_MAX_DB,
    Math.max(VELOCITY_MIN_DB, magnitudeDb),
  );
  const normalized =
    (clamped - VELOCITY_MIN_DB) / (VELOCITY_MAX_DB - VELOCITY_MIN_DB);
  return Math.max(1, Math.round(normalized * 127));
}

// Microphone-based note input. Mirrors useBluetooth: it is given an onNoteEvent
// callback and funnels detected notes through it as the same (note, kind)
// events, so the mode hooks are source-agnostic.
export function useMicrophone(
  onNoteEvent?: (noteNumber: number, kind: "on" | "off") => void,
): MicrophoneState {
  const [status, setStatus] = useState<MicrophoneStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [detectedNotes, setDetectedNotes] = useState<number[]>([]);

  const onNoteEventRef = useRef(onNoteEvent);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const magnitudeBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const trackerRef = useRef<NoteTrackerState | null>(null);
  // The last detected set we pushed to state, so we only re-render on change.
  const lastDetectedKeyRef = useRef<string>("");

  useEffect(() => {
    onNoteEventRef.current = onNoteEvent;
  }, [onNoteEvent]);

  function stop() {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    try {
      sourceRef.current?.disconnect();
    } catch {}
    sourceRef.current = null;
    analyserRef.current = null;
    magnitudeBufferRef.current = null;
    trackerRef.current = null;
    try {
      for (const track of streamRef.current?.getTracks() ?? []) {
        track.stop();
      }
    } catch {}
    streamRef.current = null;
    try {
      void audioContextRef.current?.close();
    } catch {}
    audioContextRef.current = null;
    lastDetectedKeyRef.current = "";
  }

  function analyze() {
    const analyser = analyserRef.current;
    const buffer = magnitudeBufferRef.current;
    const tracker = trackerRef.current;
    const audioContext = audioContextRef.current;
    if (!analyser || !buffer || !tracker || !audioContext) {
      return;
    }
    analyser.getFloatFrequencyData(buffer);

    const peaks = findSpectralPeaks(buffer, {
      sampleRate: audioContext.sampleRate,
      fftSize: FFT_SIZE,
      thresholdDb: THRESHOLD_DB,
      minFrequency: MIN_FREQUENCY,
      maxFrequency: MAX_FREQUENCY,
    });
    const detected = peaksToMidiNotes(peaks);

    // Velocity per detected note from the loudest peak that rounds to it.
    const velocities = new Map<number, number>();
    for (const peak of peaks) {
      const { midiNote } = nearestMidiNote(peak.frequency);
      if (!detected.has(midiNote)) {
        continue;
      }
      const velocity = magnitudeToVelocity(peak.magnitude);
      const existing = velocities.get(midiNote);
      if (existing === undefined || velocity > existing) {
        velocities.set(midiNote, velocity);
      }
    }

    const events = trackFrame(tracker, detected, velocities);
    for (const event of events) {
      onNoteEventRef.current?.(event.noteNumber, event.kind);
    }

    // Report the currently-on notes for the readout, only when they change.
    const onNotes = [...tracker.notes.entries()]
      .filter(([, noteState]) => noteState.isOn)
      .map(([noteNumber]) => noteNumber)
      .sort((a, b) => a - b);
    const key = onNotes.join(",");
    if (key !== lastDetectedKeyRef.current) {
      lastDetectedKeyRef.current = key;
      setDetectedNotes(onNotes);
    }

    animationFrameRef.current = requestAnimationFrame(analyze);
  }

  async function enable() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser doesn't expose microphone access (getUserMedia). A secure context (HTTPS) and a Chromium-based browser are required.",
      );
      setStatus("error");
      return;
    }
    setStatus("requesting");
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      const message = (err as { message?: string })?.message ?? "";
      // Chrome reports "Permission dismissed" when the user closes the prompt
      // without choosing — treat only that as a silent cancel.
      if (name === "NotAllowedError" && /dismiss/i.test(message)) {
        setStatus("idle");
        return;
      }
      // NotAllowedError otherwise means the permission was denied or blocked —
      // crucially, Brave/Chrome on Android reject *without showing a prompt*
      // when the mic is blocked by site or browser settings, so surface it.
      if (name === "NotAllowedError") {
        setError(
          "Microphone permission was denied or is blocked. Check this site's permissions — on Brave, also check Shields and Settings → Site settings → Microphone.",
        );
        setStatus("error");
        return;
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("No microphone was found on this device.");
        setStatus("error");
        return;
      }
      setError(message || String(err));
      setStatus("error");
      return;
    }

    try {
      const audioContext = new AudioContext();
      // Mobile browsers start the context suspended; resume within the gesture.
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      // No smoothing — we want responsive frames; smoothing blurs onsets.
      analyser.smoothingTimeConstant = 0;
      // Connect mic → analyser only; never to destination (avoids echo).
      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      analyserRef.current = analyser;
      magnitudeBufferRef.current = new Float32Array(
        new ArrayBuffer(
          analyser.frequencyBinCount * Float32Array.BYTES_PER_ELEMENT,
        ),
      );
      trackerRef.current = createNoteTracker();
      lastDetectedKeyRef.current = "";

      setDetectedNotes([]);
      setStatus("active");
      animationFrameRef.current = requestAnimationFrame(analyze);
    } catch (err) {
      stop();
      setError(String(err));
      setStatus("error");
    }
  }

  function disable() {
    stop();
    setDetectedNotes([]);
    setStatus("idle");
  }

  // Release the microphone if the component unmounts while active.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stop only touches refs
  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  return { status, error, detectedNotes, enable, disable };
}
