import { parseMidi } from "midi-file";
import { useState } from "preact/hooks";

const BLE_MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const BLE_MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

type NoteEvent = {
  id: number;
  time: string;
  kind: "on" | "off";
  note: number;
  name: string;
  velocity: number;
};

let nextId = 0;

type BtStatus = "idle" | "connecting" | "connected" | "error";

function midiNoteName(n: number): string {
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

function parseBLEMIDI(data: Uint8Array): NoteEvent[] {
  const events: NoteEvent[] = [];
  let i = 1; // skip header byte
  let status = 0;

  while (i < data.length) {
    if (data[i] & 0x80) {
      i++; // skip timestamp byte
      if (i < data.length && data[i] & 0x80) {
        status = data[i++]; // new status byte follows timestamp
      }
    }
    if (i >= data.length) break;

    const type = status & 0xf0;
    if (type === 0x80 || type === 0x90) {
      if (i + 1 < data.length) {
        const note = data[i] & 0x7f;
        const velocity = data[i + 1] & 0x7f;
        i += 2;
        const isOn = type === 0x90 && velocity > 0;
        events.push({
          id: nextId++,
          time: new Date().toTimeString().slice(0, 8),
          kind: isOn ? "on" : "off",
          note,
          name: midiNoteName(note),
          velocity,
        });
      }
    } else {
      i++; // skip unhandled byte
    }
  }
  return events;
}

export function App() {
  const [midiJson, setMidiJson] = useState<object | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [btStatus, setBtStatus] = useState<BtStatus>("idle");
  const [btError, setBtError] = useState<string | null>(null);
  const [noteLog, setNoteLog] = useState<NoteEvent[]>([]);

  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setMidiJson(null);

    file.arrayBuffer().then((buffer) => {
      try {
        const parsed = parseMidi(new Uint8Array(buffer));
        setMidiJson(parsed);
      } catch (err) {
        setError(String(err));
      }
    });
  }

  async function connectPiano() {
    setBtStatus("connecting");
    setBtError(null);
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_MIDI_SERVICE] }],
      });
      if (!device.gatt) throw new Error("No GATT server on device");
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
      const char = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
      await char.startNotifications();
      char.addEventListener("characteristicvaluechanged", (e) => {
        const val = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (!val) return;
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
    <div>
      <h1>MIDI Inspector</h1>
      <input type="file" accept=".mid,.midi" onChange={handleFile} />
      {fileName && <p>File: {fileName}</p>}
      {error && <p style="color: red">{error}</p>}
      {midiJson && (
        <pre style="white-space: pre-wrap; word-break: break-all">
          {JSON.stringify(midiJson, null, 2)}
        </pre>
      )}

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
    </div>
  );
}
