// Web MIDI message parsing/building. Unlike BLE MIDI (see ble-midi.ts), the Web
// MIDI API delivers one complete, header-less MIDI message per
// `MIDIMessageEvent`, so parsing is just reading the status and data bytes — no
// BLE header byte and no interleaved timestamp bytes to skip.

export type ParsedNote = { note: number; kind: "on" | "off" };

// Parses a single Web MIDI message. Returns the note event for Note On / Note
// Off messages (a Note On with velocity 0 counts as Note Off, per the MIDI
// spec) and nothing for any other message type.
export function parseMidiMessage(data: Uint8Array): ParsedNote[] {
  if (data.length < 3) {
    return [];
  }
  const type = data[0] & 0xf0;
  if (type !== 0x80 && type !== 0x90) {
    return [];
  }
  const note = data[1] & 0x7f;
  const velocity = data[2] & 0x7f;
  const isOn = type === 0x90 && velocity > 0;
  return [{ note, kind: isOn ? "on" : "off" }];
}

// ALSA (and some other systems) expose a virtual "MIDI Through" loopback port
// that carries no real device input. It's enumerated alongside real pianos, so
// skip it when deciding which ports to listen on / send to.
export function isThroughPort(name: string | null | undefined): boolean {
  return !!name && /through/i.test(name);
}

// Builds a 3-byte Note On (velocity > 0) or Note Off (velocity 0) message for
// sending through a MIDIOutput port.
export function buildNoteMessage(
  note: number,
  velocity: number,
  channel = 0,
): number[] {
  const status = (velocity > 0 ? 0x90 : 0x80) | (channel & 0x0f);
  return [status, note & 0x7f, velocity & 0x7f];
}
