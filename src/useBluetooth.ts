import { useEffect, useRef, useState } from "preact/hooks";
import {
  BLE_MIDI_CHARACTERISTIC,
  BLE_MIDI_SERVICE,
  buildBLEMIDIBatch,
  buildBLEMIDINote,
  parseBLEMIDI,
} from "./ble-midi";

export type BtStatus = "idle" | "connecting" | "connected" | "error";

export interface BluetoothState {
  status: BtStatus;
  deviceName: string | null;
  error: string | null;
  connect: () => Promise<void>;
  /** Send a note to the connected device. No-op when not connected. */
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

export function useBluetooth(
  onNoteEvent?: (noteNumber: number, kind: "on" | "off") => void,
): BluetoothState {
  const [status, setStatus] = useState<BtStatus>("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onNoteEventRef = useRef(onNoteEvent);
  const charRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  useEffect(() => {
    onNoteEventRef.current = onNoteEvent;
  }, [onNoteEvent]);

  async function connectDevice(device: BluetoothDevice) {
    if (!device.gatt) {
      throw new Error("No GATT server on device");
    }
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    const char = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
    charRef.current = char;
    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", (e) => {
      const val = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!val) {
        return;
      }
      const events = parseBLEMIDI(new Uint8Array(val.buffer));
      for (const ev of events) {
        onNoteEventRef.current?.(ev.note, ev.kind);
      }
    });
    device.addEventListener("gattserverdisconnected", () => {
      charRef.current = null;
      setStatus("idle");
      setDeviceName(null);
    });
    setDeviceName(device.name ?? "BLE MIDI Device");
    setStatus("connected");
  }

  // On mount, silently try to reconnect to any previously authorized device.
  // connectDevice only closes over refs and stable state setters, so it's safe
  // to omit from deps and run this effect exactly once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: connectDevice is stable
  useEffect(() => {
    async function tryAutoReconnect() {
      if (!navigator.bluetooth) {
        return;
      }
      // getDevices() is Chrome 85+ — guard for older browsers.
      if (typeof navigator.bluetooth.getDevices !== "function") {
        return;
      }
      let devices: BluetoothDevice[];
      try {
        devices = await navigator.bluetooth.getDevices();
      } catch {
        return;
      }
      if (devices.length === 0) {
        return;
      }
      setStatus("connecting");
      try {
        // Use the first previously-authorized device. If there are multiple,
        // the most recently used one tends to come first in practice.
        await connectDevice(devices[0]);
      } catch {
        // Device is off or out of range — fail silently.
        setStatus("idle");
      }
    }
    tryAutoReconnect();
  }, []);

  async function connect() {
    if (!navigator.bluetooth) {
      setError("Web Bluetooth not available");
      setStatus("error");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_MIDI_SERVICE] }],
      });
      await connectDevice(device);
    } catch (err) {
      const msg = String(err);
      // User dismissed the device picker — not an error, just go back to idle.
      if (msg.includes("cancelled") || msg.includes("User cancelled")) {
        setStatus("idle");
        return;
      }
      setError(msg);
      setStatus("error");
    }
  }

  function sendNote(
    note: number,
    velocity: number,
    durationMs: number,
    channel = 0,
  ) {
    const char = charRef.current;
    if (!char) {
      return;
    }
    try {
      char.writeValueWithoutResponse(buildBLEMIDINote(note, velocity, channel));
      setTimeout(() => {
        try {
          charRef.current?.writeValueWithoutResponse(
            buildBLEMIDINote(note, 0, channel),
          );
        } catch {}
      }, durationMs);
    } catch {}
  }

  function sendNotesBatch(
    notes: { note: number; velocity: number; durationMs: number }[],
    channel = 0,
  ) {
    const char = charRef.current;
    if (!char || notes.length === 0) {
      return;
    }
    try {
      char.writeValueWithoutResponse(
        buildBLEMIDIBatch(
          notes.map((n) => ({ note: n.note, velocity: n.velocity })),
          channel,
        ),
      );
      // Group Note Offs by duration so simultaneous releases go in one packet.
      const byDuration = new Map<number, number[]>();
      for (const { note, durationMs } of notes) {
        const key = Math.round(durationMs);
        const list = byDuration.get(key) ?? [];
        list.push(note);
        byDuration.set(key, list);
      }
      for (const [duration, noteList] of byDuration) {
        setTimeout(() => {
          try {
            charRef.current?.writeValueWithoutResponse(
              buildBLEMIDIBatch(
                noteList.map((n) => ({ note: n, velocity: 0 })),
                channel,
              ),
            );
          } catch {}
        }, duration);
      }
    } catch {}
  }

  return { status, deviceName, error, connect, sendNote, sendNotesBatch };
}
