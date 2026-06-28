import { useState } from "preact/hooks";
import { type BtStatus, useBluetooth } from "./use-bluetooth";
import { useWebMidi } from "./use-web-midi";

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

  return {
    status: active.status,
    deviceName: active.deviceName,
    error: active.error,
    source,
    bluetoothSupported,
    midiSupported,
    connectBluetooth: async () => {
      setLastSource("bluetooth");
      await bluetooth.connect();
    },
    connectMidi: async () => {
      setLastSource("midi");
      await webMidi.connect();
    },
    sendNote: sender.sendNote,
    sendNotesBatch: sender.sendNotesBatch,
  };
}
