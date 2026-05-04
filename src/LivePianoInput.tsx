import { useState } from "preact/hooks";
import {
  BLE_MIDI_CHARACTERISTIC,
  BLE_MIDI_SERVICE,
  type NoteEvent,
  parseBLEMIDI,
} from "./ble-midi";

type BtStatus = "idle" | "connecting" | "connected" | "error";

export function LivePianoInput() {
  const [btStatus, setBtStatus] = useState<BtStatus>("idle");
  const [btError, setBtError] = useState<string | null>(null);
  const [noteLog, setNoteLog] = useState<NoteEvent[]>([]);

  // Connects to a BLE MIDI device using the Web Bluetooth API.
  // Web Bluetooth overview: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
  // BLE MIDI spec: https://midi.org/midi-over-bluetooth-low-energy-ble-midi
  async function connectPiano() {
    setBtStatus("connecting");
    setBtError(null);
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_MIDI_SERVICE] }],
      });
      if (!device.gatt) {
        throw new Error("No GATT server on device");
      }
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
      const char = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
      await char.startNotifications();
      // characteristicvaluechanged fires each time the piano sends a BLE MIDI packet.
      // https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic/characteristicvaluechanged_event
      char.addEventListener("characteristicvaluechanged", (e) => {
        const val = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (!val) {
          return;
        }
        const events = parseBLEMIDI(new Uint8Array(val.buffer));
        if (events.length > 0) {
          setNoteLog((prev) => [...events.reverse(), ...prev].slice(0, 200));
        }
      });
      setBtStatus("connected");
    } catch (err) {
      setBtError(String(err));
      setBtStatus("error");
    }
  }

  return (
    <>
      <hr />
      <h2>Live Piano Input</h2>

      <details>
        <summary>Setup instructions</summary>
        <ol>
          <li>
            <strong>Pair your piano with your phone</strong> before opening the
            app: go to Android Settings → Connected devices → Pair new device.
            First put your piano into Bluetooth pairing mode (check its manual —
            often a dedicated BT button to hold). No PIN is required for most
            BLE MIDI devices.
          </li>
          <li>
            <strong>Enable Web Bluetooth in Brave</strong> (one-time step): open{" "}
            <code>brave://flags</code> in Brave, search for{" "}
            <code>enable-experimental-web-platform-features</code>, set it to{" "}
            <strong>Enabled</strong>, then tap <strong>Relaunch</strong> at the
            bottom.
          </li>
          <li>
            <strong>Tap "Connect Piano" below</strong> and select your piano
            from the browser's device picker. Once connected, press keys on the
            piano to see them appear in the log.
          </li>
        </ol>
      </details>

      {!navigator.bluetooth && (
        <p style="color: orange">
          Web Bluetooth is not available. Follow the setup instructions above to
          enable it in Brave.
        </p>
      )}
      {navigator.bluetooth && btStatus !== "connected" && (
        <button
          type="button"
          onClick={connectPiano}
          disabled={btStatus === "connecting"}
        >
          {btStatus === "connecting" ? "Connecting…" : "Connect Piano"}
        </button>
      )}
      {btStatus === "connected" && <p style="color: green">Connected</p>}
      {btError && <p style="color: red">{btError}</p>}
      {noteLog.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Note</th>
              <th>Type</th>
              <th>Velocity</th>
            </tr>
          </thead>
          <tbody>
            {noteLog.map((ev) => (
              <tr key={ev.id} style={ev.kind === "off" ? "color: gray" : ""}>
                <td>{ev.time}</td>
                <td>
                  {ev.name} ({ev.note})
                </td>
                <td>{ev.kind === "on" ? "On" : "Off"}</td>
                <td>{ev.velocity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
