// Standard BLE MIDI GATT service and characteristic UUIDs, defined in the
// Apple MIDI over Bluetooth Low Energy specification (also adopted by the MIDI
// Association): https://midi.org/midi-over-bluetooth-low-energy-ble-midi
export const BLE_MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const BLE_MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";

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

// Our own data model for a parsed MIDI note event. The fields map directly to
// what the MIDI spec calls Note On / Note Off messages (status, note number,
// velocity), plus UI-convenience fields (id, time, name).
export type NoteEvent = {
  id: number;
  time: string;
  kind: "on" | "off";
  note: number; // 0–127, per the MIDI spec
  name: string; // e.g. "C4"
  velocity: number; // 0–127
};

let nextId = 0;

export function midiNoteName(n: number): string {
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

// Builds a minimal BLE MIDI packet containing a single Note On or Note Off.
// Format: [header, timestamp, status, note, velocity] — timestamps are zeroed.
export function buildBLEMIDINote(
  note: number,
  velocity: number, // 0 = Note Off
): Uint8Array {
  const status = velocity > 0 ? 0x90 : 0x80; // ch 1 Note On / Note Off
  return new Uint8Array([0x80, 0x80, status, note & 0x7f, velocity & 0x7f]);
}

//
// We implement this inline rather than using an off-the-shelf library because
// the only widely-referenced JS BLE MIDI library (skratchdot/ble-midi) has not
// been maintained for 7+ years and adds no meaningful value over the ~30 lines
// needed to handle note on/off for a piano.
//
// Packet format (Apple BLE MIDI spec, section 4):
//   [header byte] ([timestamp byte] [MIDI status] [data...])...
// Bytes with bit 7 set that appear before a new MIDI message are timestamps
// and are skipped. MIDI data bytes always have bit 7 clear (values 0–127).
export function parseBLEMIDI(data: Uint8Array): NoteEvent[] {
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
    if (i >= data.length) {
      break;
    }

    const type = status & 0xf0;
    if (type === 0x80 || type === 0x90) {
      if (i + 1 < data.length) {
        const note = data[i] & 0x7f;
        const velocity = data[i + 1] & 0x7f;
        i += 2;
        // Note On with velocity 0 is equivalent to Note Off (MIDI spec running status).
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
      i++; // skip unhandled message type
    }
  }
  return events;
}
