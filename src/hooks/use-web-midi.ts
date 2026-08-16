import { useEffect, useRef, useState } from "preact/hooks";
import {
  buildNoteMessage,
  isThroughPort,
  parseMidiMessage,
} from "../../lib/midi/web-midi";
import type { BtStatus } from "./use-bluetooth";
import type { PianoTransport } from "./use-piano";

/**
 * Web MIDI input/output transport. Sees any MIDI device Chrome exposes —
 * USB-connected pianos and, on Linux, BLE pianos that BlueZ bridges to ALSA
 * (which Web Bluetooth itself can't reach once BlueZ claims the GATT service).
 * Mirrors the `useBluetooth` surface so the app can treat the two identically.
 */
export function useWebMidi(
  onNoteEvent?: (noteNumber: number, kind: "on" | "off") => void,
): PianoTransport {
  const [status, setStatus] = useState<BtStatus>("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onNoteEventRef = useRef(onNoteEvent);
  // Keep the access object alive for the lifetime of the connection so its
  // ports keep delivering events.
  const accessRef = useRef<MIDIAccess | null>(null);
  const inputsRef = useRef<MIDIInput[]>([]);
  const outputRef = useRef<MIDIOutput | null>(null);

  useEffect(() => {
    onNoteEventRef.current = onNoteEvent;
  }, [onNoteEvent]);

  function handleMidiMessage(event: MIDIMessageEvent) {
    const data = event.data;
    if (!data) {
      return;
    }
    for (const ev of parseMidiMessage(data)) {
      onNoteEventRef.current?.(ev.note, ev.kind);
    }
  }

  function attach(access: MIDIAccess, inputs: MIDIInput[]) {
    accessRef.current = access;
    // Listen on every real input so it doesn't matter which port is the piano
    // (systems often expose extra ports, e.g. the ALSA "MIDI Through" loopback).
    for (const input of inputs) {
      input.onmidimessage = handleMidiMessage;
    }
    inputsRef.current = inputs;
    // Prefer an output port from a connected input's device for note sends.
    const outputs = [...access.outputs.values()].filter(
      (o) => !isThroughPort(o.name),
    );
    const inputNames = new Set(inputs.map((i) => i.name));
    outputRef.current =
      outputs.find((o) => inputNames.has(o.name)) ?? outputs[0] ?? null;
    setDeviceName(inputs[0]?.name ?? "MIDI Device");
    setStatus("connected");
    access.onstatechange = () => {
      const stillConnected = inputsRef.current.some(
        (i) => i.state === "connected",
      );
      if (inputsRef.current.length > 0 && !stillConnected) {
        for (const input of inputsRef.current) {
          input.onmidimessage = null;
        }
        inputsRef.current = [];
        outputRef.current = null;
        setStatus("idle");
        setDeviceName(null);
      }
    };
  }

  /**
   * Requests access and attaches to every real input port. Returns null on
   * success, or a human-readable reason on failure — leaving it to the caller
   * to decide whether that failure is worth surfacing (an explicit Connect tap)
   * or should stay silent (auto-reconnect on load).
   */
  async function attemptConnect(): Promise<string | null> {
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const inputs = [...access.inputs.values()].filter(
        (i) => !isThroughPort(i.name),
      );
      if (inputs.length === 0) {
        return "No MIDI input devices found";
      }
      attach(access, inputs);
      return null;
    } catch (err) {
      return String(err);
    }
  }

  async function connect(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      setError("Web MIDI not available");
      setStatus("error");
      return false;
    }
    setStatus("connecting");
    setError(null);
    const failure = await attemptConnect();
    if (failure !== null) {
      setError(failure);
      setStatus("error");
      return false;
    }
    return true;
  }

  // On mount, silently reattach when this origin already holds the MIDI
  // permission. Unlike Web Bluetooth's per-device grant, the Web MIDI
  // permission is persistent and origin-scoped, and `requestMIDIAccess` needs
  // no user gesture — so once the user has granted it, a USB piano can
  // reconnect with zero taps. Gating on an already-"granted" permission is what
  // keeps this silent: we never trigger a permission prompt from page load.
  // attemptConnect only closes over refs and stable state setters, so it's safe
  // to omit from deps and run this effect exactly once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attemptConnect is stable
  useEffect(() => {
    async function tryAutoReconnect() {
      if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
        return;
      }
      // Browsers that don't expose the "midi" permission descriptor throw here;
      // skip auto-reconnect rather than risk an unprompted permission request.
      try {
        const permission = await navigator.permissions.query({
          name: "midi",
        } as PermissionDescriptor);
        if (permission.state !== "granted") {
          return;
        }
      } catch {
        return;
      }
      setStatus("connecting");
      if ((await attemptConnect()) !== null) {
        // No piano plugged in, or access failed — fail silently back to idle so
        // no error modal appears on load.
        setStatus("idle");
      }
    }
    tryAutoReconnect();
  }, []);

  function sendNote(
    note: number,
    velocity: number,
    durationMs: number,
    channel = 0,
  ) {
    const output = outputRef.current;
    if (!output) {
      return;
    }
    try {
      output.send(buildNoteMessage(note, velocity, channel));
      // MIDIOutput.send accepts a timestamp, so the Note Off can be scheduled
      // up front rather than via setTimeout.
      output.send(
        buildNoteMessage(note, 0, channel),
        performance.now() + durationMs,
      );
    } catch {}
  }

  function sendNotesBatch(
    notes: { note: number; velocity: number; durationMs: number }[],
    channel = 0,
  ) {
    const output = outputRef.current;
    if (!output || notes.length === 0) {
      return;
    }
    try {
      const now = performance.now();
      for (const { note, velocity } of notes) {
        output.send(buildNoteMessage(note, velocity, channel));
      }
      for (const { note, durationMs } of notes) {
        output.send(buildNoteMessage(note, 0, channel), now + durationMs);
      }
    } catch {}
  }

  return { status, deviceName, error, connect, sendNote, sendNotesBatch };
}
