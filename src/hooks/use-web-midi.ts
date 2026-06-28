import { useEffect, useRef, useState } from "preact/hooks";
import { buildNoteMessage, parseMidiMessage } from "../../lib/midi/web-midi";
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
  const inputRef = useRef<MIDIInput | null>(null);
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

  function attach(access: MIDIAccess, input: MIDIInput) {
    input.onmidimessage = handleMidiMessage;
    inputRef.current = input;
    // Prefer an output port from the same device for sending notes (playalong).
    const outputs = [...access.outputs.values()];
    outputRef.current =
      outputs.find((o) => o.name === input.name) ?? outputs[0] ?? null;
    setDeviceName(input.name ?? "MIDI Device");
    setStatus("connected");
    access.addEventListener("statechange", () => {
      if (inputRef.current && inputRef.current.state === "disconnected") {
        inputRef.current = null;
        outputRef.current = null;
        setStatus("idle");
        setDeviceName(null);
      }
    });
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
      const inputs = [...access.inputs.values()];
      if (inputs.length === 0) {
        setError("No MIDI input devices found");
        setStatus("error");
        return;
      }
      // Use the first available input. Pianos typically expose a single port.
      attach(access, inputs[0]);
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
