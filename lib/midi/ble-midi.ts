// Standard BLE MIDI GATT service and characteristic UUIDs, defined in the
// Apple MIDI over Bluetooth Low Energy specification (also adopted by the MIDI
// Association): https://midi.org/midi-over-bluetooth-low-energy-ble-midi
export const BLE_MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const BLE_MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";

// Builds a BLE MIDI packet with multiple Note On events (no running status).
// Format: [header] ([ts][status][note][vel]) * N
export function buildBLEMIDIBatch(
  notes: { note: number; velocity: number }[],
  channel = 0,
): Uint8Array<ArrayBuffer> {
  if (notes.length === 0) {
    return new Uint8Array(new ArrayBuffer(0)) as Uint8Array<ArrayBuffer>;
  }
  if (notes.length === 1) {
    return buildBLEMIDINote(notes[0].note, notes[0].velocity, channel);
  }
  const size = 1 + 4 * notes.length;
  const buf = new ArrayBuffer(size);
  const view = new Uint8Array(buf);
  let offset = 0;
  view[offset++] = 0x80;
  const status = 0x90 | (channel & 0x0f);
  for (const { note, velocity } of notes) {
    view[offset++] = 0x80;
    view[offset++] = status;
    view[offset++] = note & 0x7f;
    view[offset++] = velocity & 0x7f;
  }
  return view as Uint8Array<ArrayBuffer>;
}

// Mirrors lib/midi/web-midi.ts's ParsedNote — the only fields any consumer
// reads (the note number and on/off kind). Deliberately not an id/timestamp/
// name-carrying record: nothing downstream needs more than this.
export type ParsedNote = { note: number; kind: "on" | "off" };

// Builds a minimal BLE MIDI packet containing a single Note On or Note Off.
// Format: [header, timestamp, status, note, velocity] — timestamps are zeroed.
export function buildBLEMIDINote(
  note: number,
  velocity: number, // 0 = Note Off
  channel = 0, // 0–15; channel 9 = GM percussion
): Uint8Array<ArrayBuffer> {
  const statusBase = velocity > 0 ? 0x90 : 0x80; // Note On / Note Off
  const status = statusBase | (channel & 0x0f);
  const buf = new ArrayBuffer(5);
  const view = new Uint8Array(buf);
  view[0] = 0x80;
  view[1] = 0x80;
  view[2] = status;
  view[3] = note & 0x7f;
  view[4] = velocity & 0x7f;
  return view;
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
export function parseBLEMIDI(data: Uint8Array): ParsedNote[] {
  const events: ParsedNote[] = [];
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
        events.push({ note, kind: isOn ? "on" : "off" });
      } else {
        // Truncated message: a note byte with no paired velocity byte left in
        // the packet. Nothing more to parse — stop rather than looping
        // forever re-inspecting the same incomplete tail (i would otherwise
        // never advance).
        break;
      }
    } else {
      i++; // skip unhandled message type
    }
  }
  return events;
}
