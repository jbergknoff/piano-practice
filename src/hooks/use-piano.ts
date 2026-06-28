import { useState } from "preact/hooks";
import { type BtStatus, useBluetooth } from "./use-bluetooth";
import { listMidiInputs, useWebMidi } from "./use-web-midi";

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
  connect: () => Promise<void>;
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
  bluetoothSupported: boolean;
  midiSupported: boolean;
  /**
   * Connect, auto-selecting the transport: if a real Web MIDI input is already
   * present (USB piano, or a BLE piano the OS has bridged to MIDI), use it;
   * otherwise fall back to Web Bluetooth pairing. Avoids making the user pick.
   */
  connect: () => Promise<void>;
  connectBluetooth: () => Promise<void>;
  connectMidi: () => Promise<void>;
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
    await bluetooth.connect();
  };
  const connectMidi = async () => {
    setLastSource("midi");
    await webMidi.connect();
  };

  return {
    status: active.status,
    deviceName: active.deviceName,
    error: active.error,
    source,
    bluetoothSupported,
    midiSupported,
    connect: async () => {
      // Prefer Web MIDI when a real input is already available — it covers USB
      // pianos and OS-bridged BLE pianos and needs no pairing dialog. Otherwise
      // fall back to Bluetooth pairing.
      if (midiSupported && (await listMidiInputs()).length > 0) {
        await connectMidi();
        return;
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
