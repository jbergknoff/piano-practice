import { useState } from "preact/hooks";
import { type BtStatus, useBluetooth } from "./use-bluetooth";
import { hasMidiPermission, listMidiInputs, useWebMidi } from "./use-web-midi";

export type PianoSource = "bluetooth" | "midi";

/**
 * The surface common to every input transport (BLE MIDI via `useBluetooth`,
 * Web MIDI via `useWebMidi`). The app talks to a piano through this shape
 * regardless of how it's connected.
 */
export interface PianoTransport {
  status: BtStatus;
  deviceName: string | null;
  error: string | null;
  connect: () => Promise<boolean>;
  sendNote: (
    note: number,
    velocity: number,
    durationMs: number,
    channel?: number,
  ) => void;
  sendNotesBatch: (
    notes: { note: number; velocity: number; durationMs: number }[],
    channel?: number,
  ) => void;
}

/**
 * Unified piano connection exposed to the UI. It merges the two transports
 * into a single status/error/device view and offers a `connect*` entry point
 * per available transport. Note sends route to whichever transport is
 * currently connected.
 */
export interface PianoController {
  status: BtStatus;
  deviceName: string | null;
  error: string | null;
  /** Which transport the reported status/error belongs to (null when idle). */
  source: PianoSource | null;
  /**
   * The transport that most recently failed to connect (cleared on success),
   * so the UI can hint that the next click will try the other one.
   */
  lastFailedSource: PianoSource | null;
  bluetoothSupported: boolean;
  midiSupported: boolean;
  /**
   * Connect, auto-selecting the transport: if a real Web MIDI input is already
   * present (USB piano, or a BLE piano the OS has bridged to MIDI), use it;
   * otherwise fall back to Web Bluetooth pairing. Avoids making the user pick.
   * If the previous attempt (via this method or the explicit ones below)
   * didn't end up connected, tries the other transport instead of repeating
   * the same failed heuristic — this is what lets a first-time USB/MIDI
   * connection succeed on a machine where Bluetooth doesn't work: the MIDI
   * permission prompt only ever needs a dedicated click, never one shared
   * with a Bluetooth fallback attempt in the same gesture.
   */
  connect: () => Promise<void>;
  connectBluetooth: () => Promise<boolean>;
  connectMidi: () => Promise<boolean>;
  sendNote: PianoTransport["sendNote"];
  sendNotesBatch: PianoTransport["sendNotesBatch"];
}

export function usePiano(
  onNoteEvent?: (noteNumber: number, kind: "on" | "off") => void,
): PianoController {
  const bluetooth = useBluetooth(onNoteEvent);
  const webMidi = useWebMidi(onNoteEvent);
  // Which transport the user most recently chose, so a "connecting"/"error"
  // state surfaces from the right transport before either is connected.
  const [lastSource, setLastSource] = useState<PianoSource | null>(null);
  // Which transport's most recent connect attempt didn't end up connected —
  // drives the auto-select alternation in `connect()` below. Cleared on
  // success; untouched by transport-internal events (e.g. a later drop of an
  // established connection) since those don't go through `connectBluetooth`/
  // `connectMidi`.
  const [lastFailedSource, setLastFailedSource] = useState<PianoSource | null>(
    null,
  );

  const bluetoothSupported =
    typeof navigator !== "undefined" && !!navigator.bluetooth;
  const midiSupported =
    typeof navigator !== "undefined" &&
    typeof navigator.requestMIDIAccess === "function";

  // A connected transport always wins; otherwise reflect the one the user last
  // tried; otherwise fall back to an idle Bluetooth view.
  let active: PianoTransport;
  let source: PianoSource | null;
  if (bluetooth.status === "connected") {
    active = bluetooth;
    source = "bluetooth";
  } else if (webMidi.status === "connected") {
    active = webMidi;
    source = "midi";
  } else if (lastSource === "midi") {
    active = webMidi;
    source = "midi";
  } else if (lastSource === "bluetooth") {
    active = bluetooth;
    source = "bluetooth";
  } else {
    active = bluetooth;
    source = null;
  }

  // Outgoing notes (playalong) go to the connected transport.
  const sender =
    bluetooth.status === "connected"
      ? bluetooth
      : webMidi.status === "connected"
        ? webMidi
        : active;

  const connectBluetooth = async () => {
    setLastSource("bluetooth");
    const connected = await bluetooth.connect();
    setLastFailedSource(connected ? null : "bluetooth");
    return connected;
  };
  const connectMidi = async () => {
    setLastSource("midi");
    const connected = await webMidi.connect();
    setLastFailedSource(connected ? null : "midi");
    return connected;
  };

  return {
    status: active.status,
    deviceName: active.deviceName,
    error: active.error,
    source,
    lastFailedSource,
    bluetoothSupported,
    midiSupported,
    connect: async () => {
      // If the previous attempt tried one transport and didn't end up
      // connected, use this fresh click's gesture to try the other one
      // instead of repeating the same failed heuristic below — this is what
      // recovers a first-time USB/MIDI connection on a machine where
      // Bluetooth doesn't pan out (permission for Web MIDI hasn't been
      // granted yet, so the heuristic below would otherwise skip straight
      // past it every time).
      if (lastFailedSource === "bluetooth" && midiSupported) {
        await connectMidi();
        return;
      }
      if (lastFailedSource === "midi" && bluetoothSupported) {
        await connectBluetooth();
        return;
      }
      // Prefer Web MIDI when a real input is already available — it covers USB
      // pianos and OS-bridged BLE pianos and needs no pairing dialog. Only
      // probe for it when MIDI permission is already granted, so the probe
      // resolves instantly with no permission prompt: requesting MIDI access
      // for the first time pops a permission dialog, and on a phone (with no
      // MIDI device to find anyway) that dialog can consume the click's user
      // gesture, leaving the Bluetooth fallback below to fail with a "missing
      // user gesture" error instead of opening the device picker.
      if (midiSupported && (await hasMidiPermission())) {
        const inputs = await listMidiInputs();
        if (inputs.length > 0) {
          await connectMidi();
          return;
        }
      }
      if (bluetoothSupported) {
        await connectBluetooth();
        return;
      }
      // Neither path is available — surface Web MIDI's error.
      await connectMidi();
    },
    connectBluetooth,
    connectMidi,
    sendNote: sender.sendNote,
    sendNotesBatch: sender.sendNotesBatch,
  };
}
