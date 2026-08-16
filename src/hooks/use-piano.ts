import { useEffect, useState } from "preact/hooks";
import { loadPreferredSource, savePreferredSource } from "./piano-preference";
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
 * currently connected. There is no auto-select: the UI is responsible for
 * asking the user which transport to try (see `ConnectionBadge`'s chooser
 * modal) and calling `connectBluetooth`/`connectMidi` directly.
 */
export interface PianoController {
  status: BtStatus;
  deviceName: string | null;
  error: string | null;
  /** Which transport the reported status/error belongs to (null when idle). */
  source: PianoSource | null;
  /**
   * The transport a connect tap should try immediately, skipping the chooser —
   * the last one that connected successfully on this origin. Null once an
   * attempt has failed this session, so the very next tap falls back to the
   * chooser and the user can switch transports without being stuck in a loop
   * retrying the remembered one.
   */
  suggestedSource: PianoSource | null;
  bluetoothSupported: boolean;
  midiSupported: boolean;
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
  // The transport remembered across sessions, and whether its shortcut has
  // already been spent on a failed attempt this session.
  const [preferredSource, setPreferredSource] = useState<PianoSource | null>(
    loadPreferredSource,
  );
  const [shortcutSpent, setShortcutSpent] = useState(false);

  const bluetoothSupported =
    typeof navigator !== "undefined" && !!navigator.bluetooth;
  const midiSupported =
    typeof navigator !== "undefined" &&
    typeof navigator.requestMIDIAccess === "function";

  // Remember whichever transport reaches "connected" — covering both an
  // explicit connect tap and a silent auto-reconnect, so the preference tracks
  // what actually works rather than only what the user last clicked.
  const connectedSource: PianoSource | null =
    bluetooth.status === "connected"
      ? "bluetooth"
      : webMidi.status === "connected"
        ? "midi"
        : null;
  useEffect(() => {
    if (connectedSource !== null) {
      savePreferredSource(connectedSource);
      setPreferredSource(connectedSource);
      // A working connection re-arms the shortcut for the next disconnect.
      setShortcutSpent(false);
    }
  }, [connectedSource]);

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

  // A failed attempt (including a dismissed device picker, which resolves
  // false rather than throwing) spends the shortcut, so the next tap offers the
  // chooser instead of retrying the same transport.
  const connectBluetooth = async () => {
    setLastSource("bluetooth");
    const connected = await bluetooth.connect();
    if (!connected) {
      setShortcutSpent(true);
    }
    return connected;
  };
  const connectMidi = async () => {
    setLastSource("midi");
    const connected = await webMidi.connect();
    if (!connected) {
      setShortcutSpent(true);
    }
    return connected;
  };

  const suggestedSourceSupported =
    preferredSource === "bluetooth" ? bluetoothSupported : midiSupported;
  const suggestedSource =
    preferredSource !== null && !shortcutSpent && suggestedSourceSupported
      ? preferredSource
      : null;

  return {
    status: active.status,
    deviceName: active.deviceName,
    error: active.error,
    source,
    suggestedSource,
    bluetoothSupported,
    midiSupported,
    connectBluetooth,
    connectMidi,
    sendNote: sender.sendNote,
    sendNotesBatch: sender.sendNotesBatch,
  };
}
