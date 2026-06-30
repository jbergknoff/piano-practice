import { useEffect, useRef, useState } from "preact/hooks";
import {
  buildNoteMessage,
  isThroughPort,
  parseMidiMessage,
} from "../../lib/midi/web-midi";
import type { BtStatus } from "./use-bluetooth";
import type { PianoTransport } from "./use-piano";

/**
 * Enumerate connectable MIDI input ports, excluding the virtual "MIDI Through"
 * loopback. Used to decide whether the Web MIDI transport has anything to
 * connect to (drives auto transport selection in `usePiano`).
 */
export async function listMidiInputs(): Promise<MIDIInput[]> {
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
    return [];
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    return [...access.inputs.values()].filter((i) => !isThroughPort(i.name));
  } catch {
    return [];
  }
}

/**
 * Whether the page already holds (or has been denied) MIDI permission,
 * checked via the Permissions API so it never shows a prompt. `connect()` in
 * `usePiano` uses this to decide whether probing for a USB/bridged MIDI
 * device is "free" (permission already granted, so `requestMIDIAccess`
 * resolves instantly) versus something that would pop a permission dialog —
 * which, on a fresh page, can eat the user-activation gesture before it gets
 * a chance to fall back to `navigator.bluetooth.requestDevice()`, leaving
 * that call to fail with a "not handling a user gesture" error.
 */
export async function hasMidiPermission(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.permissions) {
    return false;
  }
  try {
    const status = await navigator.permissions.query({ name: "midi" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

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

  async function connect() {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      setError("Web MIDI not available");
      setStatus("error");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const inputs = [...access.inputs.values()].filter(
        (i) => !isThroughPort(i.name),
      );
      if (inputs.length === 0) {
        setError("No MIDI input devices found");
        setStatus("error");
        return;
      }
      attach(access, inputs);
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }

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
