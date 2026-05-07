import type { MidiData } from "midi-file";

// MusicXML divisions per quarter note (1 division = one 16th note)
const DIVISIONS = 4;

// Chromatic note names, defaulting to sharps
const NOTE_STEPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Map from grid duration (in 16th-note units) to MusicXML [type, hasDot]
const DURATION_TYPE = new Map<number, [string, boolean]>([
	[16, ["whole", false]],
	[12, ["half", true]],
	[8, ["half", false]],
	[6, ["quarter", true]],
	[4, ["quarter", false]],
	[3, ["eighth", true]],
	[2, ["eighth", false]],
	[1, ["16th", false]],
]);

// Nearest standard grid duration for values that don't map exactly
const STANDARD_DURATIONS = [16, 12, 8, 6, 4, 3, 2, 1];

interface RawNote {
	noteNumber: number;
	startTick: number;
	endTick: number;
	velocity: number;
}

// A note segment within a single measure (after barline splitting)
interface NotePart {
	noteNumber: number;
	startTick: number; // absolute
	durationTicks: number; // within this measure only
	tieStop: boolean; // continues from previous measure
	tieStart: boolean; // continues into next measure
}

function noteNumberToPitch(n: number): {
	step: string;
	alter?: number;
	octave: number;
} {
	const name = NOTE_STEPS[n % 12];
	const octave = Math.floor(n / 12) - 1;
	return name.length > 1 ? { step: name[0], alter: 1, octave } : { step: name, octave };
}

// Split a note into segments at every barline it crosses
function splitAtBarlines(note: RawNote, ticksPerMeasure: number): NotePart[] {
	const parts: NotePart[] = [];
	let tick = note.startTick;
	let first = true;
	while (tick < note.endTick) {
		const barEnd = (Math.floor(tick / ticksPerMeasure) + 1) * ticksPerMeasure;
		const segEnd = Math.min(note.endTick, barEnd);
		parts.push({
			noteNumber: note.noteNumber,
			startTick: tick,
			durationTicks: segEnd - tick,
			tieStop: !first,
			tieStart: segEnd < note.endTick,
		});
		tick = segEnd;
		first = false;
	}
	return parts;
}

// Break a grid duration into a sum of standard values (for rests)
function decompose(units: number): number[] {
	const result: number[] = [];
	let rem = units;
	while (rem > 0) {
		const v = STANDARD_DURATIONS.find((d) => d <= rem);
		if (v === undefined) break;
		result.push(v);
		rem -= v;
	}
	return result;
}

// Snap a duration to the nearest standard grid value
function snapToStandard(units: number): number {
	return STANDARD_DURATIONS.reduce((best, d) =>
		Math.abs(d - units) < Math.abs(best - units) ? d : best,
	);
}

function renderNote(
	pitch: { step: string; alter?: number; octave: number } | null,
	dur: number,
	tieStop: boolean,
	tieStart: boolean,
	chord: boolean,
	indent: string,
): string {
	const [type, dot] = DURATION_TYPE.get(dur) ?? ["quarter", false];
	const i = indent;
	const lines: string[] = [`${i}<note>`];
	if (chord) lines.push(`${i}  <chord/>`);
	if (pitch === null) {
		lines.push(`${i}  <rest/>`);
	} else {
		lines.push(`${i}  <pitch>`);
		lines.push(`${i}    <step>${pitch.step}</step>`);
		if (pitch.alter !== undefined) lines.push(`${i}    <alter>${pitch.alter}</alter>`);
		lines.push(`${i}    <octave>${pitch.octave}</octave>`);
		lines.push(`${i}  </pitch>`);
	}
	lines.push(`${i}  <duration>${dur}</duration>`);
	if (tieStop) lines.push(`${i}  <tie type="stop"/>`);
	if (tieStart) lines.push(`${i}  <tie type="start"/>`);
	lines.push(`${i}  <type>${type}</type>`);
	if (dot) lines.push(`${i}  <dot/>`);
	if ((tieStop || tieStart) && pitch !== null) {
		lines.push(`${i}  <notations>`);
		if (tieStop) lines.push(`${i}    <tied type="stop"/>`);
		if (tieStart) lines.push(`${i}    <tied type="start"/>`);
		lines.push(`${i}  </notations>`);
	}
	lines.push(`${i}</note>`);
	return lines.join("\n");
}

export function midiToMusicXml(midiData: MidiData): string {
	const tpb = midiData.header.ticksPerBeat ?? 480;

	// Defaults
	let timeSigNum = 4;
	let timeSigDen = 4;
	let keyFifths = 0;
	let keyMode = "major";

	// Collect notes from all tracks
	const rawNotes: RawNote[] = [];

	for (const track of midiData.tracks) {
		let tick = 0;
		const active = new Map<number, { startTick: number; velocity: number }>();

		for (const ev of track) {
			tick += ev.deltaTime;

			if (ev.type === "timeSignature") {
				timeSigNum = ev.numerator;
				// midi-file already converts the MIDI denominator byte to the actual value
				timeSigDen = ev.denominator;
			} else if (ev.type === "keySignature") {
				keyFifths = ev.key;
				keyMode = ev.scale === 0 ? "major" : "minor";
			} else if (ev.type === "noteOn" && ev.velocity > 0) {
				active.set(ev.noteNumber, { startTick: tick, velocity: ev.velocity });
			} else if (ev.type === "noteOff" || (ev.type === "noteOn" && ev.velocity === 0)) {
				const a = active.get(ev.noteNumber);
				if (a) {
					rawNotes.push({
						noteNumber: ev.noteNumber,
						startTick: a.startTick,
						endTick: tick,
						velocity: a.velocity,
					});
					active.delete(ev.noteNumber);
				}
			}
		}
	}

	if (rawNotes.length === 0) return emptyScore(keyFifths, keyMode, timeSigNum, timeSigDen);

	// Quantize to 16th-note grid
	const grid = tpb / 4;
	const snap = (t: number) => Math.round(t / grid) * grid;
	const quantized: RawNote[] = rawNotes.map((n) => {
		const s = snap(n.startTick);
		const e = Math.max(s + grid, snap(n.endTick));
		return { ...n, startTick: s, endTick: e };
	});

	const ticksPerMeasure = (tpb * timeSigNum * 4) / timeSigDen;
	const totalTicks = Math.max(...quantized.map((n) => n.endTick));
	const numMeasures = Math.ceil(totalTicks / ticksPerMeasure);

	// Split all notes at barlines and sort
	const parts: NotePart[] = quantized
		.flatMap((n) => splitAtBarlines(n, ticksPerMeasure))
		.sort((a, b) => a.startTick - b.startTick || a.noteNumber - b.noteNumber);

	const measureXml: string[] = [];
	const ind = "    ";

	for (let m = 0; m < numMeasures; m++) {
		const mStart = m * ticksPerMeasure;
		const mEnd = mStart + ticksPerMeasure;

		// Parts whose start falls in this measure
		const mParts = parts.filter((p) => p.startTick >= mStart && p.startTick < mEnd);

		const lines: string[] = [];

		if (m === 0) {
			lines.push(
				`${ind}<attributes>`,
				`${ind}  <divisions>${DIVISIONS}</divisions>`,
				`${ind}  <key><fifths>${keyFifths}</fifths><mode>${keyMode}</mode></key>`,
				`${ind}  <time><beats>${timeSigNum}</beats><beat-type>${timeSigDen}</beat-type></time>`,
				`${ind}  <clef><sign>G</sign><line>2</line></clef>`,
				`${ind}</attributes>`,
			);
		}

		let cursor = mStart;
		let i = 0;

		while (i < mParts.length) {
			const startTick = mParts[i].startTick;

			// Fill gap before this beat with rests
			if (startTick > cursor) {
				const restGrid = Math.round((startTick - cursor) / grid);
				for (const d of decompose(restGrid)) {
					lines.push(renderNote(null, d, false, false, false, ind));
				}
			}

			// Collect all parts at the same tick (chord group)
			let j = i;
			while (j < mParts.length && mParts[j].startTick === startTick) j++;
			const chord = mParts.slice(i, j);

			for (let k = 0; k < chord.length; k++) {
				const p = chord[k];
				const durRaw = Math.round(p.durationTicks / grid);
				const dur = DURATION_TYPE.has(durRaw) ? durRaw : snapToStandard(durRaw);
				const pitch = noteNumberToPitch(p.noteNumber);
				lines.push(renderNote(pitch, dur, p.tieStop, p.tieStart, k > 0, ind));
			}

			// Cursor advances by the first note's duration (standard MusicXML behaviour)
			const firstDurRaw = Math.round(chord[0].durationTicks / grid);
			const firstDur = DURATION_TYPE.has(firstDurRaw) ? firstDurRaw : snapToStandard(firstDurRaw);
			cursor = startTick + firstDur * grid;
			i = j;
		}

		// Fill rest at end of measure
		if (cursor < mEnd) {
			const restGrid = Math.round((mEnd - cursor) / grid);
			for (const d of decompose(restGrid)) {
				lines.push(renderNote(null, d, false, false, false, ind));
			}
		}

		measureXml.push(`  <measure number="${m + 1}">\n${lines.join("\n")}\n  </measure>`);
	}

	return scoreTemplate(measureXml.join("\n"));
}

function emptyScore(
	keyFifths: number,
	keyMode: string,
	timeSigNum: number,
	timeSigDen: number,
): string {
	const fullMeasureDur = timeSigNum * DIVISIONS;
	return scoreTemplate(
		`  <measure number="1">
    <attributes>
      <divisions>${DIVISIONS}</divisions>
      <key><fifths>${keyFifths}</fifths><mode>${keyMode}</mode></key>
      <time><beats>${timeSigNum}</beats><beat-type>${timeSigDen}</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef>
    </attributes>
    <note><rest measure="yes"/><duration>${fullMeasureDur}</duration></note>
  </measure>`,
	);
}

function scoreTemplate(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${body}
  </part>
</score-partwise>`;
}
