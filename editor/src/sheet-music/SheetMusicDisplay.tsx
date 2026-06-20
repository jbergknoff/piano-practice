import { memo } from "preact/compat";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { computeMeasureStartBeats } from "./measure-beats";
import { diatonicIndex, isRest, parseScore } from "./musicxml-parser";
import type {
  AccidentalKind,
  ChordGroup,
  GraceGroup,
  LayoutConfig,
  MeasureEvent,
  NoteType,
  ParsedMeasure,
  ParsedNote,
  ParsedPart,
  ParsedRest,
  ParsedScore,
  Pitch,
  ResolvedLayout,
} from "./sheet-music-types";
import type { NoteHighlight } from "./highlights";
import {
  ACCIDENTAL_BASE_OFFSET_FACTOR,
  ACCIDENTAL_COLUMN_WIDTH_FACTOR,
  DIVISIONS,
  FLAT_POSITIONS,
  GRACE_NOTE_ADVANCE,
  KEY_CHANGE_GLYPH_SPACING_FACTOR,
  KEY_CHANGE_LEAD_FACTOR,
  MIN_EVENT_ADVANCE,
  SHARP_POSITIONS,
  accidentalColumns,
  beamStemDirection,
  eventXsFromSpine,
  groupBeamableEvents,
  keyChangeGlyphs,
  ledgerLineYs,
  noteY,
  resolveLayout,
  stemDirection,
} from "./sheet-music-layout";
import {
  EMBEDDED_GLYPH_FONT_BASE64,
  GLYPH_FONT_FAMILY,
} from "./embedded-glyph-font";
import { G, timeSigGlyphs } from "./glyphs";

// The notation glyphs are SMuFL codepoints that only render correctly in a
// SMuFL font, so the package bundles its own Bravura subset and registers it
// here — consumers get working notation with zero font setup. Injected once per
// document at module load (guarded for SSR + idempotency) so the @font-face is
// in place before first paint. `font-display: block` avoids a flash of tofu.
function injectGlyphFont(): void {
  if (typeof document === "undefined") {
    return;
  }
  const elementId = "sheet-music-glyph-font";
  if (document.getElementById(elementId)) {
    return;
  }
  const style = document.createElement("style");
  style.id = elementId;
  style.textContent = `@font-face{font-family:'${GLYPH_FONT_FAMILY}';src:url(data:font/woff2;base64,${EMBEDDED_GLYPH_FONT_BASE64}) format('woff2');font-display:block;}`;
  document.head.appendChild(style);
}
injectGlyphFont();

// Default family for plain text (measure numbers). Unlike the glyph font this is
// a free choice, so it stays an optional `textFontFamily` prop.
const DEFAULT_TEXT_FONT_FAMILY =
  "'Geist', ui-sans-serif, system-ui, sans-serif";

// ── Beam geometry ─────────────────────────────────────────────────────────────

interface BeamGroupData {
  eventIndices: number[];
  stemDir: "up" | "down";
  /** Y coordinate of the primary beam at the first stem */
  beamStartY: number;
  /** Y coordinate of the primary beam at the last stem */
  beamEndY: number;
  /** Per-event stem X and the Y where the stem meets the beam */
  stems: Array<{ stemX: number; stemTipY: number }>;
  /** NoteType of each event, used to place secondary beams for 16th notes */
  types: NoteType[];
}

// Beam groups span one beat (one denominator unit) so long runs break into
// per-beat sub-beams. DIVISIONS is divisions per quarter note.
function beamUnitDivisions(beatType: number): number {
  return (DIVISIONS * 4) / beatType;
}

function computeBeamGroups(
  events: MeasureEvent[],
  eventXs: number[],
  clef: { sign: "G" | "F"; line: number },
  staffBottomY: number,
  staffSpace: number,
  beatDivisions: number,
): BeamGroupData[] {
  const stemLength = staffSpace * 3;
  // Diagonal beams may not exceed this total rise/fall, keeping angles readable.
  const maxBeamRise = staffSpace * 1.5;
  const nrx = staffSpace * 0.55;

  return groupBeamableEvents(events, beatDivisions).map((indices) => {
    const chords = indices.map((i) => events[i] as ChordGroup);
    const stemDir = beamStemDirection(chords, clef);

    // Reference Y for each chord: the notehead the beam must clear, i.e. the
    // outermost note in the beam direction (top note for stem-up, bottom note
    // for stem-down). The natural beam position sits stemLength beyond this.
    const referenceYs = chords.map((g) => {
      const ys = g.notes.map((n) =>
        noteY(n.pitch, clef, staffBottomY, staffSpace),
      );
      return stemDir === "up" ? Math.min(...ys) : Math.max(...ys);
    });

    const stemXs = indices.map((i) =>
      stemDir === "up" ? eventXs[i] + nrx : eventXs[i] - nrx,
    );

    // Beam endpoints: natural stem tip (standard length) for the first and last
    // chord, then clamped so the total rise stays within maxBeamRise.
    const beamStartY =
      stemDir === "up"
        ? referenceYs[0] - stemLength
        : referenceYs[0] + stemLength;
    const naturalEndY =
      stemDir === "up"
        ? referenceYs[referenceYs.length - 1] - stemLength
        : referenceYs[referenceYs.length - 1] + stemLength;
    const rawRise = naturalEndY - beamStartY;
    const beamEndY =
      beamStartY + Math.max(-maxBeamRise, Math.min(maxBeamRise, rawRise));

    // Slope in SVG-Y-per-X. Interpolate each stem's tip along the beam line.
    const dX = stemXs[stemXs.length - 1] - stemXs[0];
    const slope = dX === 0 ? 0 : (beamEndY - beamStartY) / dX;

    // Ensure no interior chord's beam point falls short of clearing its own
    // outermost notehead. Shift the entire beam if any chord has a shortfall.
    let beamShift = 0;
    for (let j = 0; j < chords.length; j++) {
      const tipY = beamStartY + slope * (stemXs[j] - stemXs[0]);
      if (stemDir === "up") {
        const shortfall = tipY - (referenceYs[j] - stemLength);
        if (shortfall > beamShift) {
          beamShift = shortfall;
        }
      } else {
        const shortfall = referenceYs[j] + stemLength - tipY;
        if (shortfall > beamShift) {
          beamShift = shortfall;
        }
      }
    }
    const adjustedBeamStartY =
      stemDir === "up" ? beamStartY - beamShift : beamStartY + beamShift;
    const adjustedBeamEndY =
      stemDir === "up" ? beamEndY - beamShift : beamEndY + beamShift;

    const stems = chords.map((_, j) => ({
      stemX: stemXs[j],
      stemTipY: adjustedBeamStartY + slope * (stemXs[j] - stemXs[0]),
    }));

    return {
      eventIndices: indices,
      stemDir,
      beamStartY: adjustedBeamStartY,
      beamEndY: adjustedBeamEndY,
      stems,
      types: chords.map((g) => g.type),
    };
  });
}

// Compute secondary beam segments for 16th notes within a beam group.
// Returns x/y endpoints for each segment, following the diagonal of the primary
// beam (offset toward the noteheads by beamOffset).
function secondaryBeamSegments(
  types: NoteType[],
  stems: Array<{ stemX: number; stemTipY: number }>,
  beamOffset: number,
  stemDir: "up" | "down",
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const yOffset = stemDir === "up" ? beamOffset : -beamOffset;
  // Pre-compute beam slope for interpolating y at stub endpoints.
  const dX = stems[stems.length - 1].stemX - stems[0].stemX;
  const slope =
    dX === 0 ? 0 : (stems[stems.length - 1].stemTipY - stems[0].stemTipY) / dX;

  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> =
    [];
  let i = 0;
  while (i < types.length) {
    if (types[i] !== "16th") {
      i++;
      continue;
    }
    const runStart = i;
    while (i < types.length && types[i] === "16th") {
      i++;
    }
    const runEnd = i;

    if (runEnd - runStart === 1) {
      // Isolated 16th: half-stub toward nearest neighbor.
      const idx = runStart;
      const stemY = stems[idx].stemTipY + yOffset;
      if (idx > 0) {
        const halfGap = (stems[idx].stemX - stems[idx - 1].stemX) / 2;
        segments.push({
          x1: stems[idx].stemX - halfGap,
          y1: stemY - slope * halfGap,
          x2: stems[idx].stemX,
          y2: stemY,
        });
      } else {
        const halfGap =
          ((stems[idx + 1]?.stemX ?? stems[idx].stemX + 10) -
            stems[idx].stemX) /
          2;
        segments.push({
          x1: stems[idx].stemX,
          y1: stemY,
          x2: stems[idx].stemX + halfGap,
          y2: stemY + slope * halfGap,
        });
      }
    } else {
      segments.push({
        x1: stems[runStart].stemX,
        y1: stems[runStart].stemTipY + yOffset,
        x2: stems[runEnd - 1].stemX,
        y2: stems[runEnd - 1].stemTipY + yOffset,
      });
    }
  }
  return segments;
}

// ── Cursor position helper ────────────────────────────────────────────────────

export function computeCursorX(
  beat: number,
  score: ParsedScore,
  layout: ResolvedLayout,
  measureStartBeats: number[],
): number | null {
  const timeSig = score.parts[0]?.timeSig ?? { beats: 4, beatType: 4 };

  // Binary search for the measure containing `beat`: the largest index i where
  // measureStartBeats[i] <= beat. This handles pickup measures and any other
  // irregular measure lengths that the old floor(beat / beatsPerMeasure) formula
  // would get wrong.
  let measureIndex = 0;
  {
    let low = 0;
    let high = measureStartBeats.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (measureStartBeats[mid] <= beat) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    measureIndex = low;
  }
  const beatInMeasure = beat - (measureStartBeats[measureIndex] ?? 0);

  const spine = layout.measureSpines[measureIndex];
  if (!spine) {
    return null;
  }

  // Walk the shared rhythm spine to find the X for the current beat.
  // Duration in MusicXML divisions; 4 divisions = 1 quarter note.
  const divisionsPerBeat = DIVISIONS * (4 / timeSig.beatType);
  const targetDiv = beatInMeasure * divisionsPerBeat;
  const barlineX = layout.measureXs[measureIndex];
  const endBarlineX = barlineX + layout.measureWidths[measureIndex];

  const { divs, xs } = spine;
  if (divs.length === 0) {
    return barlineX;
  }

  // The cursor must land on the actual downbeat notehead (xs[0]) at the
  // downbeat — not the barline. The clef/key/padding lead-in that sits to the
  // left of a measure's first note is dead space the cursor sweeps during the
  // PREVIOUS measure's final beat, so the terminal anchor is the next measure's
  // first onset (or the closing barline for the last measure). This keeps the
  // cursor continuous across barlines while staying glued to the notes.
  const nextSpine = layout.measureSpines[measureIndex + 1];
  const measureEndX = nextSpine?.xs[0] ?? endBarlineX;

  for (let k = 0; k < divs.length; k++) {
    const segEndDiv = k + 1 < divs.length ? divs[k + 1] : spine.endDiv;
    if (targetDiv < segEndDiv) {
      const x0 = xs[k];
      const x1 = k + 1 < xs.length ? xs[k + 1] : measureEndX;
      const span = segEndDiv - divs[k];
      const frac = span > 0 ? (targetDiv - divs[k]) / span : 0;
      return x0 + frac * (x1 - x0);
    }
  }

  return measureEndX;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Per-note geometry needed to draw (or recolor) a notehead. This is the single
// source of truth for notehead placement, shared by ChordGroupEl (ink notes)
// and the NoteColorOverlay (highlight glyphs) so the two can never drift.
interface NoteRenderInfo {
  id: string;
  nx: number;
  ny: number;
  type: NoteType;
  accidental: AccidentalKind;
  /** Absolute x of the accidental glyph (staggered within a chord). */
  accidentalX: number;
  dot: boolean;
  staffSpace: number;
  /**
   * Glyph font-size override. Set for grace noteheads (which render smaller
   * than full notes); left undefined for regular notes, which inherit the
   * document's default glyph font-size.
   */
  fontSize?: number;
}

// Resolve the per-event beam stem overrides (direction + tip Y) for a measure.
// Used by both Measure (to render stems/beams) and computeNoteRenderInfos.
function beamStemOverrides(
  events: MeasureEvent[],
  eventXs: number[],
  clef: { sign: "G" | "F"; line: number },
  staffBottomY: number,
  staffSpace: number,
  beatDivisions: number,
): {
  beamGroups: BeamGroupData[];
  beamOverrideMap: Map<number, { stemDir: "up" | "down"; stemTipY: number }>;
} {
  const beamGroups = computeBeamGroups(
    events,
    eventXs,
    clef,
    staffBottomY,
    staffSpace,
    beatDivisions,
  );
  const beamOverrideMap = new Map<
    number,
    { stemDir: "up" | "down"; stemTipY: number }
  >();
  for (const group of beamGroups) {
    group.eventIndices.forEach((ei, i) => {
      beamOverrideMap.set(ei, {
        stemDir: group.stemDir,
        stemTipY: group.stems[i].stemTipY,
      });
    });
  }
  return { beamGroups, beamOverrideMap };
}

// Map each note's accidental column (from the shared layout rule) to an absolute
// x. Column 0 sits ACCIDENTAL_BASE_OFFSET_FACTOR staff-spaces left of the
// notehead; each further column steps ACCIDENTAL_COLUMN_WIDTH_FACTOR further
// left. Notes without an accidental get the column-0 x (unused).
function accidentalColumnXs(
  notes: ParsedNote[],
  ex: number,
  staffSpace: number,
): number[] {
  const baseX = ex - staffSpace * ACCIDENTAL_BASE_OFFSET_FACTOR;
  const colWidth = staffSpace * ACCIDENTAL_COLUMN_WIDTH_FACTOR;
  return accidentalColumns(notes, staffSpace).map((col) =>
    col < 0 ? baseX : baseX - col * colWidth,
  );
}

// Notehead placement for one chord group. stemDir must already be resolved
// (beam override ?? stemDirection) since it feeds the intra-chord x offsets.
function chordNoteGeometry(
  group: ChordGroup,
  ex: number,
  partIndex: number,
  measureNumber: number,
  clef: { sign: "G" | "F"; line: number },
  staffBottomY: number,
  staffSpace: number,
  stemDir: "up" | "down",
): NoteRenderInfo[] {
  const { type, notes, noteIndex, dot } = group;
  const nrx = staffSpace * 0.55;
  const xOffsets = chordXOffsets(notes, stemDir, nrx);
  const accidentalXs = accidentalColumnXs(notes, ex, staffSpace);
  return notes.map((note, v) => ({
    id: `p${partIndex}-m${measureNumber}-n${noteIndex}-v${v}`,
    nx: ex + xOffsets[v],
    ny: noteY(note.pitch, clef, staffBottomY, staffSpace),
    type,
    accidental: note.accidental,
    accidentalX: accidentalXs[v],
    dot: !!dot,
    staffSpace,
  }));
}

// Notehead placement for the grace-note groups preceding a chord. Mirrors the
// geometry in ChordGroupEl/GraceNoteGroupEl (grace x cascade, smaller scale, and
// the leftward shift past the main chord's accidentals) so the NoteColorOverlay
// can recolor grace noteheads — e.g. when a grace note is the active wait point.
function graceNoteGeometry(
  group: ChordGroup,
  ex: number,
  partIndex: number,
  measureNumber: number,
  clef: { sign: "G" | "F"; line: number },
  staffBottomY: number,
  staffSpace: number,
): NoteRenderInfo[] {
  const gracesBefore = group.gracesBefore ?? [];
  const N = gracesBefore.length;
  if (N === 0) {
    return [];
  }
  const graceScale = GRACE_FONT_FACTOR / 4;
  const graceNrx = staffSpace * 0.55 * graceScale;
  const graceFontSize = staffSpace * GRACE_FONT_FACTOR;
  const mainAccWidth = group.notes.some((n) => n.accidental !== "none")
    ? staffSpace * ACCIDENTAL_BASE_OFFSET_FACTOR
    : 0;
  const infos: NoteRenderInfo[] = [];
  gracesBefore.forEach((graceGroup, gi) => {
    const graceX = ex - mainAccWidth - (N - gi) * GRACE_NOTE_ADVANCE;
    graceGroup.notes.forEach((note, v) => {
      const nx = graceX + v * graceNrx * 0.3;
      infos.push({
        id: `p${partIndex}-m${measureNumber}-n${graceGroup.noteIndex}-v${v}`,
        nx,
        ny: noteY(note.pitch, clef, staffBottomY, staffSpace),
        // Grace notes always draw a filled (black) notehead.
        type: "quarter",
        accidental: note.accidental,
        accidentalX:
          nx - staffSpace * ACCIDENTAL_BASE_OFFSET_FACTOR * graceScale,
        dot: false,
        staffSpace,
        fontSize: graceFontSize,
      });
    });
  });
  return infos;
}

function computeNoteRenderInfos(
  score: ParsedScore,
  layout: ResolvedLayout,
): Map<string, NoteRenderInfo> {
  const infos = new Map<string, NoteRenderInfo>();
  const { staffSpace, measureSpines, staffBottomYs } = layout;

  score.parts.forEach((part, p) => {
    const staffBottomY = staffBottomYs[p];
    const clef = part.clef;
    const beatDivisions = beamUnitDivisions(part.timeSig.beatType);

    part.measures.forEach((measure, m) => {
      const eventXs = eventXsFromSpine(measure.events, measureSpines[m]);
      const { beamOverrideMap } = beamStemOverrides(
        measure.events,
        eventXs,
        clef,
        staffBottomY,
        staffSpace,
        beatDivisions,
      );

      measure.events.forEach((event, ei) => {
        if (isRest(event)) {
          return;
        }
        const group = event as ChordGroup;
        const stemDir =
          beamOverrideMap.get(ei)?.stemDir ?? stemDirection(group, clef);
        for (const info of chordNoteGeometry(
          group,
          eventXs[ei],
          p,
          measure.number,
          clef,
          staffBottomY,
          staffSpace,
          stemDir,
        )) {
          infos.set(info.id, info);
        }
        for (const info of graceNoteGeometry(
          group,
          eventXs[ei],
          p,
          measure.number,
          clef,
          staffBottomY,
          staffSpace,
        )) {
          infos.set(info.id, info);
        }
      });
    });
  });

  return infos;
}

// A drawable tie: a curve joining two noteheads of the same pitch. `startX`
// and `stopX` are the notehead-center x of the tie's two endpoints; `y` is their
// shared notehead-center y (a tie always joins the same pitch). `bulge` is the
// direction the arc curves away from the noteheads.
export interface TieArc {
  partIndex: number;
  startX: number;
  stopX: number;
  y: number;
  bulge: "up" | "down";
}

// Resolve every tie in the score to a drawable arc. A tie joins a note marked
// `tieStart` to the next same-pitch note marked `tieStop` within the same part
// (staff). The multi-staff reduction can place those two endpoints in different
// events — even across a barline — so ties are tracked across the whole part
// rather than per measure. The display is a single horizontal system (no line
// wrapping), so each arc is a simple left-to-right curve.
export function computeTieArcs(
  score: ParsedScore,
  layout: ResolvedLayout,
): TieArc[] {
  const arcs: TieArc[] = [];
  const { staffSpace, measureSpines, staffBottomYs } = layout;

  score.parts.forEach((part, p) => {
    const staffBottomY = staffBottomYs[p];
    const clef = part.clef;
    const beatDivisions = beamUnitDivisions(part.timeSig.beatType);
    // Ties curve opposite the stem: a notehead at or above the staff's middle
    // line (stem down) gets an arc above it (bulges up); one below the middle
    // (stem up) gets an arc below it (bulges down).
    const middleY = staffBottomY - 2 * staffSpace;
    // Open tie starts in this part, keyed by pitch identity (step+alter+octave).
    const openTies = new Map<string, { x: number; y: number }>();

    part.measures.forEach((measure, m) => {
      const eventXs = eventXsFromSpine(measure.events, measureSpines[m]);
      const { beamOverrideMap } = beamStemOverrides(
        measure.events,
        eventXs,
        clef,
        staffBottomY,
        staffSpace,
        beatDivisions,
      );

      measure.events.forEach((event, ei) => {
        if (isRest(event)) {
          return;
        }
        const group = event as ChordGroup;
        const stemDir =
          beamOverrideMap.get(ei)?.stemDir ?? stemDirection(group, clef);
        const geom = chordNoteGeometry(
          group,
          eventXs[ei],
          p,
          measure.number,
          clef,
          staffBottomY,
          staffSpace,
          stemDir,
        );
        group.notes.forEach((note, v) => {
          const pitchKey = `${note.pitch.step}${note.pitch.alter}/${note.pitch.octave}`;
          const here = { x: geom[v].nx, y: geom[v].ny };
          // Close an open tie before opening a new one so a note that both stops
          // and starts (a chain of ties) is handled correctly.
          if (note.tieStop) {
            const start = openTies.get(pitchKey);
            if (start) {
              arcs.push({
                partIndex: p,
                startX: start.x,
                stopX: here.x,
                y: here.y,
                bulge: here.y <= middleY ? "up" : "down",
              });
              openTies.delete(pitchKey);
            }
          }
          if (note.tieStart) {
            openTies.set(pitchKey, here);
          }
        });
      });
    });
  });

  return arcs;
}

// Sharps-preferring MIDI → diatonic pitch mapping. Mirrors noteNumberToPitch
// in the midi-to-musicxml package; duplicated here to keep this component free
// of MIDI imports.
const PITCH_TABLE: ReadonlyArray<{ step: Pitch["step"]; alter: number }> = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "D", alter: 1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: 0 },
  { step: "A", alter: 1 },
  { step: "B", alter: 0 },
];

function midiNumberToPitch(noteNumber: number): Pitch {
  const entry = PITCH_TABLE[((noteNumber % 12) + 12) % 12];
  const octave = Math.floor(noteNumber / 12) - 1;
  return { step: entry.step, alter: entry.alter, octave };
}

// Player markers: one per user key press. x comes from the press's beat, y is
// computed against whichever visible staff places the pitch closest to its
// middle line (so high notes naturally land on treble, low on bass).
const PlayerMarkerOverlay = memo(function PlayerMarkerOverlay({
  markers,
  score,
  layout,
  measureStartBeats,
  visibleParts,
  inkColor,
}: {
  markers: ReadonlyArray<{
    noteNumber: number;
    beat: number;
    color: string;
  }>;
  score: ParsedScore;
  layout: ResolvedLayout;
  measureStartBeats: number[];
  visibleParts: Set<string> | undefined;
  inkColor: string;
}) {
  const { staffSpace, staffBottomYs } = layout;
  const visibleIndices = score.parts
    .map((part, i) => ({ part, i }))
    .filter(({ part }) => (visibleParts ? visibleParts.has(part.id) : true))
    .map(({ i }) => i);
  if (visibleIndices.length === 0) {
    return null;
  }
  const radius = staffSpace * 0.5;
  const strokeWidth = Math.max(1, staffSpace * 0.12);
  return (
    <g style={{ pointerEvents: "none" }}>
      {markers.map((marker, index) => {
        const x = computeCursorX(marker.beat, score, layout, measureStartBeats);
        if (x === null) {
          return null;
        }
        const pitch = midiNumberToPitch(marker.noteNumber);
        let bestStaff = visibleIndices[0];
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const i of visibleIndices) {
          const clef = score.parts[i].clef;
          const middleY = staffBottomYs[i] - 2 * staffSpace;
          const y = noteY(pitch, clef, staffBottomYs[i], staffSpace);
          const distance = Math.abs(y - middleY);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestStaff = i;
          }
        }
        const clef = score.parts[bestStaff].clef;
        const y = noteY(pitch, clef, staffBottomYs[bestStaff], staffSpace);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: marker list is append-only during a session
          <g key={index}>
            <circle
              cx={x}
              cy={y}
              r={radius}
              fill={marker.color}
              fillOpacity={0.85}
              stroke={inkColor}
              strokeWidth={strokeWidth}
              strokeOpacity={0.85}
              data-player-marker="true"
              data-marker-pitch={marker.noteNumber}
              data-marker-beat={marker.beat}
            />
          </g>
        );
      })}
    </g>
  );
});

// Renders colored notehead glyphs on top of the ink notes. Only the notes
// present in the supplied entries are drawn, so this re-renders cheaply (a
// handful of glyphs) while the heavyweight note tree below never re-renders on
// color changes. Memoized on [infos, entries] — entries identity is stabilized
// upstream so this skips entirely when the active set is unchanged.
const NoteColorOverlay = memo(function NoteColorOverlay({
  infos,
  entries,
}: {
  infos: Map<string, NoteRenderInfo>;
  entries: ReadonlyArray<{ id: string; color: string }>;
}) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {entries.map(({ id, color }) => {
        const info = infos.get(id);
        if (!info) {
          return null;
        }
        const nrx = info.staffSpace * 0.55;
        return (
          // Grace noteheads carry a font-size override so the recolored glyph
          // matches the smaller ink note; regular notes inherit the document
          // default and leave fontSize undefined.
          <g key={id} data-color-id={id} font-size={info.fontSize}>
            <Notehead
              x={info.nx}
              y={info.ny}
              type={info.type}
              color={color}
              accidental={info.accidental}
              accidentalX={info.accidentalX}
              staffSpace={info.staffSpace}
            />
            {info.dot && (
              <circle
                cx={info.nx + nrx + 4}
                cy={info.ny - info.staffSpace / 4}
                r={1.5}
                fill={color}
              />
            )}
          </g>
        );
      })}
    </g>
  );
});

// Draws the tie arcs from computeTieArcs. Each tie is a shallow quadratic curve
// anchored just inside the near edge of each notehead and bulging away from it.
// Staves the consumer has hidden (visibleParts) are skipped. Memoized on its
// props, all stable while the score/layout are unchanged.
const TieLayer = memo(function TieLayer({
  ties,
  parts,
  visibleParts,
  inkColor,
  staffSpace,
}: {
  ties: ReadonlyArray<TieArc>;
  parts: ParsedPart[];
  visibleParts?: Set<string>;
  inkColor: string;
  staffSpace: number;
}) {
  const nrx = staffSpace * 0.55; // notehead half-width
  return (
    <g style={{ pointerEvents: "none" }} fill="none" stroke={inkColor}>
      {ties.map((tie) => {
        if (visibleParts && !visibleParts.has(parts[tie.partIndex].id)) {
          return null;
        }
        const dir = tie.bulge === "down" ? 1 : -1;
        // Anchor just inside each notehead's near edge so the arc reads as
        // joining the two heads rather than starting in empty space.
        const x1 = tie.startX + nrx * 0.9;
        const x2 = tie.stopX - nrx * 0.9;
        const yEnd = tie.y + dir * staffSpace * 0.4;
        const yControl = tie.y + dir * staffSpace * 1.1;
        const midX = (x1 + x2) / 2;
        // A tie is uniquely identified by its part and the two notehead
        // positions it joins — stable across re-renders.
        const key = `${tie.partIndex}-${tie.startX}-${tie.stopX}-${tie.y}`;
        return (
          <path
            key={key}
            data-tie={key}
            d={`M ${x1} ${yEnd} Q ${midX} ${yControl} ${x2} ${yEnd}`}
            stroke-width={staffSpace * 0.18}
            stroke-linecap="round"
          />
        );
      })}
    </g>
  );
});

interface SheetMusicDisplayProps {
  musicxml: string;
  layout?: LayoutConfig;
  noteHighlights?: ReadonlyArray<NoteHighlight>;
  visibleParts?: Set<string>;
  /** Accent color used for the focus-range handles. Defaults to blue (#1976d2). */
  accentColor?: string;
  /** Override the SMuFL glyph font-size. Defaults to 4 × the layout staff-space. */
  glyphFontSize?: number;
  /** Font family for plain text such as measure numbers. Defaults to a Geist
   *  sans-serif stack. */
  textFontFamily?: string;
  /** Color for staff lines, barlines, stems, and noteheads. Defaults to "black". */
  inkColor?: string;
  /** Extra style applied to the scroll container div. */
  containerStyle?: Record<string, unknown>;
  /** When set, draw a tinted background rect over this measure range (1-indexed, inclusive). */
  focusRange?: { from: number; to: number } | null;
  /** Fill color for the focus range highlight. */
  focusColor?: string;
  /** Called when the user finishes dragging a focus boundary handle. */
  onFocusRangeChange?: (range: { from: number; to: number }) => void;
  /** Ref written by the caller before each jump (reset/seek/mode change).
   *  The snap effect reads the beat, computes scroll position via
   *  computeCursorX, and clears the ref. */
  snapBeatRef?: { current: number | null };
  /** Incremented by the caller on every jump. The snap effect depends on this
   *  so it always fires — even if the beat is identical to the previous jump. */
  snapGeneration?: number;
  /** When true, user scroll (drag and wheel) is disabled. Set while music is playing. */
  scrollLocked?: boolean;
  /** Called on right-click or long-press with the measure and beat at that position. */
  onSheetContextMenu?: (info: {
    measureNumber: number;
    beat: number;
    clientX: number;
    clientY: number;
  }) => void;
  /**
   * When provided, a playback cursor is drawn. Returns the current beat (or
   * null to hide the cursor). While `isPlaying`, it is polled every animation
   * frame to move the cursor and page-turn the scroll; when not playing the
   * cursor is positioned once and the rAF loop stops. Position is updated via
   * direct DOM mutation — no React state.
   */
  getLiveBeat?: () => number | null;
  /** Whether playback is active. Drives the cursor rAF loop + scroll-follow. */
  isPlaying?: boolean;
  /**
   * Editor pointer seam (additive, opt-in). When any of these are supplied, the
   * staff SVG forwards raw pointer gestures up with the SVG-local coordinates
   * plus the already-computed `score`/`layout`/`measureStartBeats`, so a wrapper
   * (EditableSheetMusic) can resolve them to musical `{ beat, pitch, hit }`
   * without re-parsing. When absent the component renders the read-only view
   * exactly as before. The pointerdown handler also captures the pointer so a
   * drag keeps delivering move/up to the SVG.
   */
  onStagePointerDown?: (info: StagePointerInfo, event: PointerEvent) => void;
  onStagePointerMove?: (info: StagePointerInfo, event: PointerEvent) => void;
  onStagePointerUp?: (info: StagePointerInfo, event: PointerEvent) => void;
}

/** Payload handed to the editor pointer-seam callbacks (see props above). */
export interface StagePointerInfo {
  svgX: number;
  svgY: number;
  score: ParsedScore;
  layout: ResolvedLayout;
  measureStartBeats: number[];
}

export function SheetMusicDisplay({
  musicxml,
  layout: layoutConfig,
  noteHighlights,
  visibleParts,
  accentColor = "#1976d2",
  glyphFontSize,
  textFontFamily = DEFAULT_TEXT_FONT_FAMILY,
  inkColor = "black",
  containerStyle,
  focusRange,
  focusColor,
  onFocusRangeChange,
  snapBeatRef,
  snapGeneration,
  scrollLocked = false,
  onSheetContextMenu,
  getLiveBeat,
  isPlaying = false,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
}: SheetMusicDisplayProps) {
  const result = useMemo(() => {
    try {
      const score = parseScore(musicxml);
      const layout = resolveLayout(score, layoutConfig);
      const measureStartBeats = computeMeasureStartBeats(score);
      return { score, layout, measureStartBeats, error: null };
    } catch (e) {
      return {
        score: null,
        layout: null,
        measureStartBeats: null,
        error: String(e),
      };
    }
  }, [musicxml, layoutConfig]);

  if (result.error) {
    return <p style="color:red">{result.error}</p>;
  }
  if (!result.score || !result.layout) {
    return null;
  }
  const { score, layout, measureStartBeats } = result;
  if (score.parts.length === 0 || score.numMeasures === 0) {
    return <p>No music to display.</p>;
  }

  // Per-note geometry for the color overlay. Depends only on score + layout, so
  // it is computed once per piece and never on color changes.
  const noteInfos = useMemo(
    () => computeNoteRenderInfos(score, layout),
    [score, layout],
  );

  // Tie arcs, like noteInfos, depend only on score + layout.
  const tieArcs = useMemo(() => computeTieArcs(score, layout), [score, layout]);

  // Split the unified highlight stream into the two render passes (notehead
  // recolouring vs. arbitrary-position circles). The intermediate arrays are
  // referentially stable as long as `noteHighlights` is, so the memoized
  // overlays still skip work when nothing changed.
  const { scoreEntries, markerEntries } = useMemo(() => {
    const scores: Array<{ id: string; color: string }> = [];
    const markers: Array<{ noteNumber: number; beat: number; color: string }> =
      [];
    for (const highlight of noteHighlights ?? []) {
      if (highlight.kind === "score") {
        scores.push({ id: highlight.id, color: highlight.color });
      } else {
        markers.push({
          noteNumber: highlight.noteNumber,
          beat: highlight.beat,
          color: highlight.color,
        });
      }
    }
    return { scoreEntries: scores, markerEntries: markers };
  }, [noteHighlights]);

  const fontSize = glyphFontSize ?? layout.staffSpace * 4;

  const containerRef = useRef<HTMLDivElement>(null);
  // Mirrors the scrollLocked prop so the event handlers (set up once in a
  // useEffect([])) can read the current value without a stale closure.
  const scrollLockedRef = useRef(scrollLocked);
  scrollLockedRef.current = scrollLocked;

  // Cursor bar — an absolutely-positioned div that is a sibling of the staves
  // SVG (not a descendant), so its CSS transform changes never cause the note
  // tree to repaint. The transform is GPU-composited (will-change + contain:
  // layout) and uses the SVG x coordinate directly (the cursor scrolls with the
  // content because it lives inside the same scroll container).
  const cursorDivRef = useRef<HTMLDivElement>(null);

  // Position the cursor div at an SVG x (or hide it when x is null).
  const placeCursor = useCallback((x: number | null) => {
    const cursor = cursorDivRef.current;
    if (!cursor) {
      return;
    }
    if (x === null) {
      cursor.style.display = "none";
    } else {
      cursor.style.transform = `translateX(${x}px)`;
      cursor.style.display = "";
    }
  }, []);

  // X of the leftmost highlighted grace notehead, or null when none is
  // highlighted. A grace shares its main note's downbeat, so the beat-driven
  // cursor cannot tell the two apart; when a grace is the highlighted target
  // (Wait mode's grace wait point — no other mode highlights graces) we snap
  // the static/jump cursor onto the grace's own notehead instead. Grace
  // render-infos are tagged by a `fontSize` override, which regular noteheads
  // lack — that is what identifies them here.
  const graceHighlightCursorX = useMemo<number | null>(() => {
    let leftmost: number | null = null;
    for (const { id } of scoreEntries) {
      const info = noteInfos.get(id);
      if (info?.fontSize === undefined) {
        continue;
      }
      if (leftmost === null || info.nx < leftmost) {
        leftmost = info.nx;
      }
    }
    return leftmost;
  }, [scoreEntries, noteInfos]);

  // While playing, run a 60fps rAF loop that moves the cursor and page-turns the
  // scroll. The loop is gated on `isPlaying`, so it does NOT run while paused or
  // stopped (the cursor is static then — see the effect below). scrollLeft is
  // only written when the cursor nears the visible edge; a passive scroll
  // listener keeps currentScroll synced without reading it (a layout-flushing
  // property) in the hot path.
  useEffect(() => {
    if (!getLiveBeat || !isPlaying) {
      return;
    }
    const container = containerRef.current;
    const leftPad = container
      ? Number.parseFloat(getComputedStyle(container).paddingLeft) || 0
      : 0;
    let containerWidth = container?.clientWidth ?? 0;
    let currentScroll = container?.scrollLeft ?? 0;

    const ro = new ResizeObserver(([entry]) => {
      containerWidth = entry.contentRect.width;
    });
    const onScroll = () => {
      if (container) {
        currentScroll = container.scrollLeft;
      }
    };
    if (container) {
      ro.observe(container);
      container.addEventListener("scroll", onScroll, { passive: true });
    }

    let rafId: number;
    const tick = () => {
      const beat = getLiveBeat();
      const x =
        beat !== null
          ? computeCursorX(beat, score, layout, measureStartBeats)
          : null;
      if (x !== null && containerWidth > 0) {
        const screenX = leftPad + x - currentScroll;
        if (screenX < 0 || screenX > containerWidth * 0.85) {
          currentScroll = Math.max(0, leftPad + x - containerWidth * 0.2);
          if (container) {
            container.scrollLeft = currentScroll;
          }
        }
        placeCursor(x);
      } else {
        placeCursor(null);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      container?.removeEventListener("scroll", onScroll);
    };
  }, [getLiveBeat, isPlaying, score, layout, measureStartBeats, placeCursor]);

  // When not playing (paused, stopped, initial load) the cursor is static, so
  // position it once here instead of burning a rAF loop. Re-runs on pause/stop
  // and after every jump (snapGeneration) so seeks/resets move it immediately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapGeneration drives re-fire after jumps; score/layout compute position
  useEffect(() => {
    if (!getLiveBeat || isPlaying) {
      return;
    }
    const beat = getLiveBeat();
    const beatX =
      beat !== null
        ? computeCursorX(beat, score, layout, measureStartBeats)
        : null;
    placeCursor(graceHighlightCursorX ?? beatX);
  }, [
    getLiveBeat,
    isPlaying,
    snapGeneration,
    score,
    layout,
    placeCursor,
    graceHighlightCursorX,
  ]);

  // Instant-scroll effect for jumps (reset, seek, mode change, etc.).
  // snapGeneration increments on every jump so this effect always fires
  // even when the beat is unchanged from the previous jump.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapBeatRef is a stable ref; score/layout are used to compute position
  useEffect(() => {
    if (!snapBeatRef || snapBeatRef.current === null) {
      return;
    }
    const beat = snapBeatRef.current;
    snapBeatRef.current = null;

    const el = containerRef.current;
    if (!el) {
      return;
    }
    const x =
      graceHighlightCursorX ??
      computeCursorX(beat, score, layout, measureStartBeats);
    const leftPad = Number.parseFloat(getComputedStyle(el).paddingLeft) || 0;
    el.scrollLeft =
      x !== null ? Math.max(0, leftPad + x - el.clientWidth * 0.2) : 0;
  }, [snapGeneration, score, layout, graceHighlightCursorX]);

  // Focus handle drag state — ref tracks the live value between renders, state
  // drives visual feedback.
  const svgRef = useRef<SVGSVGElement>(null);

  // Resolve an SVG-local point for the editor pointer seam. SVG px coordinates
  // are 1:1 with client px (no viewBox scaling), so subtracting the bounding
  // rect's origin is the whole transform.
  const stagePointerInfo = (event: PointerEvent): StagePointerInfo | null => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    return {
      svgX: event.clientX - rect.left,
      svgY: event.clientY - rect.top,
      score,
      layout,
      measureStartBeats,
    };
  };

  const focusDragRef = useRef<{ handle: "left" | "right" } | null>(null);
  const dragFocusRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [dragFocusRange, setDragFocusRange] = useState<{
    from: number;
    to: number;
  } | null>(null);

  const snapToMeasureStart = (svgX: number): number => {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < layout.measureXs.length; i++) {
      const d = Math.abs(layout.measureXs[i] - svgX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best + 1;
  };

  const snapToMeasureEnd = (svgX: number): number => {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < layout.measureXs.length; i++) {
      const d = Math.abs(layout.measureXs[i] + layout.measureWidths[i] - svgX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best + 1;
  };

  const onHandlePointerDown = (e: PointerEvent, handle: "left" | "right") => {
    if (!focusRange) {
      return;
    }
    // preventDefault stops the browser from starting a native pan gesture,
    // which would fire pointercancel and kill the drag on touch devices.
    e.preventDefault();
    e.stopPropagation();
    focusDragRef.current = { handle };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragFocusRangeRef.current = { ...focusRange };
    setDragFocusRange({ ...focusRange });
  };

  const onHandlePointerMove = (e: PointerEvent) => {
    const drag = focusDragRef.current;
    if (!drag || !focusRange) {
      return;
    }

    // Auto-scroll the container when the pointer is near or beyond the edges.
    const container = containerRef.current;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const edgeScrollZone = 60;
      const maxScrollStep = 10;
      const distanceFromRight = containerRect.right - e.clientX;
      const distanceFromLeft = e.clientX - containerRect.left;
      if (distanceFromRight < edgeScrollZone) {
        container.scrollLeft +=
          maxScrollStep * (1 - Math.max(0, distanceFromRight) / edgeScrollZone);
      } else if (distanceFromLeft < edgeScrollZone) {
        container.scrollLeft -=
          maxScrollStep * (1 - Math.max(0, distanceFromLeft) / edgeScrollZone);
      }
    }

    const svgX =
      e.clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
    const current = dragFocusRangeRef.current ?? focusRange;
    const next =
      drag.handle === "left"
        ? {
            from: Math.min(snapToMeasureStart(svgX), current.to),
            to: current.to,
          }
        : {
            from: current.from,
            to: Math.max(snapToMeasureEnd(svgX), current.from),
          };
    dragFocusRangeRef.current = next;
    setDragFocusRange(next);
  };

  const onHandlePointerUp = () => {
    const range = dragFocusRangeRef.current;
    if (range && onFocusRangeChange) {
      onFocusRangeChange(range);
    }
    focusDragRef.current = null;
    dragFocusRangeRef.current = null;
    setDragFocusRange(null);
  };

  // Pointer-drag to scroll (mouse and touch via pointer events).
  const dragRef = useRef<{ startX: number; scrollLeft: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    const onPointerDown = (e: PointerEvent) => {
      if (scrollLockedRef.current) {
        return;
      }
      dragRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft };
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) {
        return;
      }
      el.scrollLeft =
        dragRef.current.scrollLeft - (e.clientX - dragRef.current.startX);
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (scrollLockedRef.current) {
        e.preventDefault();
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);
    // passive: false so we can call preventDefault() to block wheel scroll during playback.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const cursorY1 =
    layout.staffBottomYs.length > 0
      ? layout.staffBottomYs[0] - 4 * layout.staffSpace
      : 0;
  const cursorY2 =
    layout.staffBottomYs.length > 0
      ? layout.staffBottomYs[layout.staffBottomYs.length - 1]
      : layout.totalHeight;

  // Compute focus highlight rect bounds (measure indices are 1-indexed in focusRange).
  // Use dragFocusRange during an active handle drag for live visual feedback.
  const displayedFocusRange = dragFocusRange ?? focusRange;
  let focusX1: number | null = null;
  let focusX2: number | null = null;
  if (displayedFocusRange) {
    const fromIdx = displayedFocusRange.from - 1;
    const toIdx = displayedFocusRange.to - 1;
    if (fromIdx >= 0 && fromIdx < layout.measureXs.length) {
      focusX1 = layout.measureXs[fromIdx];
    }
    if (toIdx >= 0 && toIdx < layout.measureXs.length) {
      focusX2 = layout.measureXs[toIdx] + layout.measureWidths[toIdx];
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        overflowX: "auto",
        userSelect: "none",
        touchAction: "pan-x",
        cursor: dragFocusRange ? "ew-resize" : "grab",
        // Horizontal padding gives the focus-range scrubber pills room to render
        // at the very first and last measure without being clipped by the container.
        paddingInline: 8,
        ...(containerStyle as Record<string, string | number> | undefined),
      }}
      onContextMenu={(e) => {
        if (!onSheetContextMenu) {
          return;
        }
        e.preventDefault();
        dragRef.current = null;
        const containerEl = containerRef.current;
        if (!containerEl) {
          return;
        }
        const me = e as unknown as MouseEvent;
        const svgX =
          me.clientX -
          containerEl.getBoundingClientRect().left +
          containerEl.scrollLeft -
          Number.parseFloat(getComputedStyle(containerEl).paddingLeft);
        let measureIndex = 0;
        for (let i = 0; i < layout.measureXs.length; i++) {
          if (layout.measureXs[i] <= svgX) {
            measureIndex = i;
          }
        }
        const timeSig = score.parts[0]?.timeSig ?? { beats: 4, beatType: 4 };
        const beatsPerMeasure = timeSig.beats * (4 / timeSig.beatType);
        const measureX = layout.measureXs[measureIndex];
        const measureW = layout.measureWidths[measureIndex];
        const frac = Math.max(0, Math.min(1, (svgX - measureX) / measureW));
        // Use the authoritative per-measure start-beat array (same source the
        // playback cursor uses) so the seek target is correct even for pickup
        // measures and pieces with non-uniform time signatures.
        const mStart =
          measureStartBeats?.[measureIndex] ?? measureIndex * beatsPerMeasure;
        const mEnd =
          measureStartBeats?.[measureIndex + 1] ??
          (measureIndex + 1) * beatsPerMeasure;
        onSheetContextMenu({
          measureNumber: measureIndex + 1,
          beat: mStart + frac * (mEnd - mStart),
          clientX: me.clientX,
          clientY: me.clientY,
        });
      }}
    >
      {/*
        Wrapper gives a positioning context for the HTML handle overlays.
        Set font-family and font-size once here so every <text> element inside
        inherits them automatically.  Components that use a different font
        (e.g. TimeSig) override via their own attributes.
      */}
      <div
        style={{ position: "relative", display: "inline-block", flexShrink: 0 }}
      >
        <svg
          ref={svgRef}
          width={layout.totalWidth}
          height={layout.totalHeight}
          overflow="visible"
          style={{
            display: "block",
            fontFamily: GLYPH_FONT_FAMILY,
            fontSize: fontSize,
          }}
          role="img"
          aria-label="Sheet music"
          onPointerDown={
            onStagePointerDown
              ? (e) => {
                  const event = e as unknown as PointerEvent;
                  const info = stagePointerInfo(event);
                  if (!info) {
                    return;
                  }
                  // Keep the gesture on the SVG and off the container's
                  // drag-to-scroll listener while editing.
                  event.stopPropagation();
                  svgRef.current?.setPointerCapture(event.pointerId);
                  onStagePointerDown(info, event);
                }
              : undefined
          }
          onPointerMove={
            onStagePointerMove
              ? (e) => {
                  const event = e as unknown as PointerEvent;
                  const info = stagePointerInfo(event);
                  if (info) {
                    onStagePointerMove(info, event);
                  }
                }
              : undefined
          }
          onPointerUp={
            onStagePointerUp
              ? (e) => {
                  const event = e as unknown as PointerEvent;
                  const info = stagePointerInfo(event);
                  svgRef.current?.releasePointerCapture(event.pointerId);
                  if (info) {
                    onStagePointerUp(info, event);
                  }
                }
              : undefined
          }
        >
          {/* Focus range background */}
          {focusX1 !== null && focusX2 !== null && focusColor && (
            <rect
              x={focusX1}
              y={cursorY1 - 4}
              width={focusX2 - focusX1}
              height={cursorY2 - cursorY1 + 8}
              fill={focusColor}
              rx={8}
            />
          )}
          {score.parts.map((part, p) => (
            <Staff
              key={part.id}
              part={part}
              partIndex={p}
              layout={layout}
              staffBottomY={layout.staffBottomYs[p]}
              visible={visibleParts ? visibleParts.has(part.id) : true}
              inkColor={inkColor}
              textFontFamily={textFontFamily}
            />
          ))}
          {tieArcs.length > 0 && (
            <TieLayer
              ties={tieArcs}
              parts={score.parts}
              visibleParts={visibleParts}
              inkColor={inkColor}
              staffSpace={layout.staffSpace}
            />
          )}
          <NoteColorOverlay infos={noteInfos} entries={scoreEntries} />
          {markerEntries.length > 0 && (
            <PlayerMarkerOverlay
              markers={markerEntries}
              score={score}
              layout={layout}
              measureStartBeats={measureStartBeats}
              visibleParts={visibleParts}
              inkColor={inkColor}
            />
          )}
          {/* Visible handle bars — SVG only, no pointer events */}
          {focusX1 !== null && focusX2 !== null && onFocusRangeChange && (
            <g style={{ pointerEvents: "none" }}>
              {([focusX1, focusX2] as const).map((x) => {
                const midY = (cursorY1 + cursorY2) / 2;
                return (
                  <g key={x}>
                    {/* Thin edge line */}
                    <rect
                      x={x - 1}
                      y={cursorY1 - 4}
                      width={2}
                      height={cursorY2 - cursorY1 + 8}
                      fill={accentColor}
                      opacity={0.35}
                    />
                    {/* Pill thumb */}
                    <rect
                      x={x - 6}
                      y={midY - 18}
                      width={12}
                      height={36}
                      rx={6}
                      fill={accentColor}
                      opacity={0.9}
                    />
                    {/* Grip lines */}
                    <line
                      x1={x - 3}
                      y1={midY - 6}
                      x2={x + 3}
                      y2={midY - 6}
                      stroke="white"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                    <line
                      x1={x - 3}
                      y1={midY}
                      x2={x + 3}
                      y2={midY}
                      stroke="white"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                    <line
                      x1={x - 3}
                      y1={midY + 6}
                      x2={x + 3}
                      y2={midY + 6}
                      stroke="white"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    />
                  </g>
                );
              })}
            </g>
          )}
        </svg>
        {/* HTML overlay hit areas — position: absolute uses SVG px coords directly.
            HTML elements have reliable touch-action support unlike SVG elements. */}
        {focusX1 !== null && focusX2 !== null && onFocusRangeChange && (
          <>
            <div
              style={{
                position: "absolute",
                top: cursorY1 - 4,
                left: focusX1 - 14,
                width: 28,
                height: cursorY2 - cursorY1 + 8,
                cursor: "ew-resize",
                touchAction: "none",
              }}
              onPointerDown={(e) =>
                onHandlePointerDown(e as unknown as PointerEvent, "left")
              }
              onPointerMove={(e) =>
                onHandlePointerMove(e as unknown as PointerEvent)
              }
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
              onContextMenu={(e) => e.preventDefault()}
            />
            <div
              style={{
                position: "absolute",
                top: cursorY1 - 4,
                left: focusX2 - 14,
                width: 28,
                height: cursorY2 - cursorY1 + 8,
                cursor: "ew-resize",
                touchAction: "none",
              }}
              onPointerDown={(e) =>
                onHandlePointerDown(e as unknown as PointerEvent, "right")
              }
              onPointerMove={(e) =>
                onHandlePointerMove(e as unknown as PointerEvent)
              }
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
              onContextMenu={(e) => e.preventDefault()}
            />
          </>
        )}
        {getLiveBeat && (
          <div
            ref={cursorDivRef}
            data-cursor="true"
            style={{
              position: "absolute",
              top: cursorY1,
              left: 0,
              width: 2,
              height: cursorY2 - cursorY1,
              background: accentColor,
              opacity: 0.75,
              pointerEvents: "none",
              willChange: "transform",
              contain: "layout",
              display: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Staff ─────────────────────────────────────────────────────────────────────

interface StaffProps {
  part: ParsedPart;
  partIndex: number;
  layout: ResolvedLayout;
  staffBottomY: number;
  visible: boolean;
  inkColor: string;
  textFontFamily: string;
}

const Staff = memo(function Staff({
  part,
  partIndex,
  layout,
  staffBottomY,
  visible,
  inkColor,
  textFontFamily,
}: StaffProps) {
  const { staffSpace, totalWidth, measureXs, measureWidths } = layout;
  const beatDivisions = beamUnitDivisions(part.timeSig.beatType);
  return (
    <g visibility={visible ? "visible" : "hidden"}>
      <StaffLines
        totalWidth={totalWidth}
        staffBottomY={staffBottomY}
        staffSpace={staffSpace}
        inkColor={inkColor}
      />
      {part.measures.map((measure, m) => (
        <Measure
          key={measure.number}
          measure={measure}
          measureIndex={m}
          partIndex={partIndex}
          clef={part.clef}
          beatDivisions={beatDivisions}
          isFirstMeasure={m === 0}
          x={measureXs[m]}
          staffBottomY={staffBottomY}
          layout={layout}
          inkColor={inkColor}
          textFontFamily={textFontFamily}
        />
      ))}
      {/* Final barline at right edge of last measure */}
      {measureXs.length > 0 && (
        <Barline
          x={
            measureXs[measureXs.length - 1] +
            measureWidths[measureWidths.length - 1]
          }
          staffBottomY={staffBottomY}
          staffSpace={staffSpace}
          inkColor={inkColor}
        />
      )}
    </g>
  );
});

// ── Staff Lines ───────────────────────────────────────────────────────────────

function StaffLines({
  totalWidth,
  staffBottomY,
  staffSpace,
  inkColor,
}: {
  totalWidth: number;
  staffBottomY: number;
  staffSpace: number;
  inkColor: string;
}) {
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = staffBottomY - i * staffSpace;
        return (
          <line
            key={i}
            x1={0}
            x2={totalWidth}
            y1={y}
            y2={y}
            stroke={inkColor}
            stroke-width="0.8"
            stroke-opacity="0.55"
          />
        );
      })}
    </g>
  );
}

// ── Barline ───────────────────────────────────────────────────────────────────

function Barline({
  x,
  staffBottomY,
  staffSpace,
  inkColor,
}: { x: number; staffBottomY: number; staffSpace: number; inkColor: string }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={staffBottomY - 4 * staffSpace}
      y2={staffBottomY}
      stroke={inkColor}
      stroke-width="0.9"
      stroke-opacity="0.55"
    />
  );
}

// ── Measure ───────────────────────────────────────────────────────────────────

interface MeasureProps {
  measure: ParsedMeasure;
  measureIndex: number;
  partIndex: number;
  clef: { sign: "G" | "F"; line: number };
  beatDivisions: number;
  isFirstMeasure: boolean;
  x: number;
  staffBottomY: number;
  layout: ResolvedLayout;
  inkColor: string;
  textFontFamily: string;
}

function Measure({
  measure,
  measureIndex,
  partIndex,
  clef,
  beatDivisions,
  isFirstMeasure,
  x,
  staffBottomY,
  layout,
  inkColor,
  textFontFamily,
}: MeasureProps) {
  const { staffSpace } = layout;
  const spine = layout.measureSpines[measureIndex];

  // Note positions and beam geometry depend only on the score + layout, never
  // on note colors. Memoize so color changes during playback don't recompute
  // them — and so beamOverrideMap entries keep a stable identity, letting the
  // memoized ChordGroupEl skip re-rendering.
  const { eventXs, beamGroups, beamOverrideMap } = useMemo(() => {
    const eventXs = eventXsFromSpine(measure.events, spine);
    const { beamGroups, beamOverrideMap } = beamStemOverrides(
      measure.events,
      eventXs,
      clef,
      staffBottomY,
      staffSpace,
      beatDivisions,
    );
    return { eventXs, beamGroups, beamOverrideMap };
  }, [measure.events, spine, staffSpace, clef, staffBottomY, beatDivisions]);

  const clefX = x + 2;
  const keySigX = clefX + 32;
  const timeSigX = keySigX + Math.abs(measure.activeFifths) * 10;

  return (
    <g>
      <Barline
        x={x}
        staffBottomY={staffBottomY}
        staffSpace={staffSpace}
        inkColor={inkColor}
      />
      {partIndex === 0 && (
        <text
          x={x + 4}
          y={staffBottomY - 4 * staffSpace - 5}
          font-size={staffSpace * 0.85}
          font-family={textFontFamily}
          fill={inkColor}
          fill-opacity={0.38}
        >
          {measureIndex + 1}
        </text>
      )}
      {isFirstMeasure && (
        <>
          <Clef
            clef={clef}
            x={clefX}
            staffBottomY={staffBottomY}
            staffSpace={staffSpace}
            inkColor={inkColor}
          />
          <KeySig
            keySig={{ fifths: measure.activeFifths }}
            clef={clef}
            x={keySigX}
            staffBottomY={staffBottomY}
            staffSpace={staffSpace}
            inkColor={inkColor}
          />
          <TimeSig
            timeSig={measure.timeSig ?? { beats: 4, beatType: 4 }}
            x={timeSigX}
            staffBottomY={staffBottomY}
            staffSpace={staffSpace}
            inkColor={inkColor}
          />
        </>
      )}
      {!isFirstMeasure && measure.keyChange && (
        <KeySigChange
          keyChange={measure.keyChange}
          clef={clef}
          x={x + staffSpace * KEY_CHANGE_LEAD_FACTOR}
          staffBottomY={staffBottomY}
          staffSpace={staffSpace}
          inkColor={inkColor}
        />
      )}
      {(() => {
        let beatOffset = 0;
        return measure.events.map((event, ei) => {
          const key = `o${beatOffset}`;
          const dur = isRest(event)
            ? event.duration
            : (event as ChordGroup).duration;
          beatOffset += dur;
          const ex = eventXs[ei];
          if (isRest(event)) {
            return (
              <RestEl
                key={key}
                rest={event}
                x={ex}
                staffBottomY={staffBottomY}
                staffSpace={staffSpace}
                inkColor={inkColor}
              />
            );
          }
          const group = event as ChordGroup;
          return (
            <ChordGroupEl
              key={key}
              group={group}
              x={ex}
              staffBottomY={staffBottomY}
              clef={clef}
              partIndex={partIndex}
              measureNumber={measure.number}
              staffSpace={staffSpace}
              beamStemOverride={beamOverrideMap.get(ei)}
              inkColor={inkColor}
            />
          );
        });
      })()}
      <BeamLines
        beamGroups={beamGroups}
        staffSpace={staffSpace}
        inkColor={inkColor}
      />
    </g>
  );
}

// ── Clef ──────────────────────────────────────────────────────────────────────

function Clef({
  clef,
  x,
  staffBottomY,
  staffSpace,
  inkColor,
}: {
  clef: { sign: "G" | "F" };
  x: number;
  staffBottomY: number;
  staffSpace: number;
  inkColor: string;
}) {
  const char = clef.sign === "G" ? G.gClef : G.fClef;
  // SMuFL origins: G clef baseline sits on the G line (2nd line = 1 staffSpace up);
  // F clef baseline sits on the F line (4th line = 3 staffSpaces up).
  const y =
    clef.sign === "G"
      ? staffBottomY - staffSpace
      : staffBottomY - 3 * staffSpace;
  return (
    <text x={x + 2} y={y} fill={inkColor}>
      {char}
    </text>
  );
}

// ── Key Signature ─────────────────────────────────────────────────────────────

function KeySig({
  keySig,
  clef,
  x,
  staffBottomY,
  staffSpace,
  inkColor,
}: {
  keySig: { fifths: number };
  clef: { sign: "G" | "F" };
  x: number;
  staffBottomY: number;
  staffSpace: number;
  inkColor: string;
}) {
  const { fifths } = keySig;
  if (fifths === 0) {
    return null;
  }

  const positions =
    fifths > 0
      ? SHARP_POSITIONS[clef.sign].slice(0, fifths)
      : FLAT_POSITIONS[clef.sign].slice(0, -fifths);
  const symbol = fifths > 0 ? G.accSharp : G.accFlat;
  const spacing = staffSpace * 1.1;

  return (
    <g>
      {positions.map((pitch, i) => {
        const y = noteY(pitch, clef, staffBottomY, staffSpace);
        return (
          <text
            key={`${pitch.step}${pitch.octave}`}
            x={x + i * spacing}
            y={y}
            text-anchor="middle"
            fill={inkColor}
          >
            {symbol}
          </text>
        );
      })}
    </g>
  );
}

// ── Mid-staff key change ──────────────────────────────────────────────────────

// Drawn at the start of a measure where the key signature changes: naturals to
// cancel the outgoing accidentals no longer in the new key, then the new key's
// sharps or flats. Glyph spacing matches the width reserved by the layout.
function KeySigChange({
  keyChange,
  clef,
  x,
  staffBottomY,
  staffSpace,
  inkColor,
}: {
  keyChange: { fifths: number; prevFifths: number };
  clef: { sign: "G" | "F" };
  x: number;
  staffBottomY: number;
  staffSpace: number;
  inkColor: string;
}) {
  const { naturals, accidentals } = keyChangeGlyphs(keyChange, clef.sign);
  const accSymbol = keyChange.fifths > 0 ? G.accSharp : G.accFlat;
  const glyphs = [
    ...naturals.map((pitch) => ({ pitch, symbol: G.accNatural })),
    ...accidentals.map((pitch) => ({ pitch, symbol: accSymbol })),
  ];
  const spacing = staffSpace * KEY_CHANGE_GLYPH_SPACING_FACTOR;

  return (
    <g>
      {glyphs.map(({ pitch, symbol }, i) => {
        const y = noteY(pitch, clef, staffBottomY, staffSpace);
        return (
          <text
            key={`${pitch.step}${pitch.octave}-${i}`}
            x={x + i * spacing}
            y={y}
            text-anchor="middle"
            fill={inkColor}
          >
            {symbol}
          </text>
        );
      })}
    </g>
  );
}

// ── Time Signature ────────────────────────────────────────────────────────────

function TimeSig({
  timeSig,
  x,
  staffBottomY,
  staffSpace,
  inkColor,
}: {
  timeSig: { beats: number; beatType: number };
  x: number;
  staffBottomY: number;
  staffSpace: number;
  inkColor: string;
}) {
  const centerX = x + 10;
  // Inherit the staff's Bravura font and base size (4 × staffSpace), so the
  // SMuFL digits sit at the engraving-standard height of two staff spaces each.
  // SMuFL time-signature glyphs are registered centered on the baseline, so we
  // use the default (alphabetic) baseline and place each y at the desired
  // vertical center — numerator in the upper half, denominator in the lower.
  return (
    <g fill={inkColor}>
      <text x={centerX} y={staffBottomY - staffSpace * 3} text-anchor="middle">
        {timeSigGlyphs(timeSig.beats)}
      </text>
      <text x={centerX} y={staffBottomY - staffSpace * 1} text-anchor="middle">
        {timeSigGlyphs(timeSig.beatType)}
      </text>
    </g>
  );
}

// ── Grace Note Group ─────────────────────────────────────────────────────────

// Grace notes are rendered at 50% of full notehead size (font-size = 2 ×
// staffSpace vs. 4 × staffSpace for regular notes). They always use filled
// (black) noteheads, always stem up, and always show an eighth-note flag.
// Acciaccatura (slash=true) additionally draws a diagonal slash through the stem.
const GRACE_FONT_FACTOR = 2.4; // × staffSpace

function GraceNoteGroupEl({
  graceGroup,
  x,
  staffBottomY,
  clef,
  partIndex,
  measureNumber,
  staffSpace,
  inkColor,
  showFlag,
  stemTipOverride,
}: {
  graceGroup: GraceGroup;
  x: number;
  staffBottomY: number;
  clef: { sign: "G" | "F"; line: number };
  partIndex: number;
  measureNumber: number;
  staffSpace: number;
  inkColor: string;
  /** When false the flag is suppressed — the group belongs to a beamed run. */
  showFlag: boolean;
  /** When set, stems extend to this Y rather than the default fixed length. */
  stemTipOverride?: number;
}) {
  const { notes, slash, noteIndex } = graceGroup;
  const fontSize = staffSpace * GRACE_FONT_FACTOR;
  // Scale factor relative to full size — used for geometry adjustments.
  const scale = GRACE_FONT_FACTOR / 4;
  const nrx = staffSpace * 0.55 * scale; // notehead half-width
  const stemLength = staffSpace * 2.5;

  return (
    <g data-grace-id={`p${partIndex}-m${measureNumber}-n${noteIndex}`}>
      {notes.map((note, vi) => {
        const ny = noteY(note.pitch, clef, staffBottomY, staffSpace);
        const nx = x + vi * nrx * 0.3; // slight rightward cascade for unisons
        const stemX = nx + nrx;
        const stemTipY = stemTipOverride ?? ny - stemLength;
        const noteId = `p${partIndex}-m${measureNumber}-n${noteIndex}-v${vi}`;

        // Accidental offset — scaled down for grace size
        const accX = nx - staffSpace * ACCIDENTAL_BASE_OFFSET_FACTOR * scale;

        return (
          <g key={noteId}>
            {/* Accidental */}
            {note.accidental !== "none" && (
              <text
                x={accX}
                y={ny}
                fill={inkColor}
                text-anchor="middle"
                font-size={fontSize}
              >
                {ACCIDENTAL_GLYPH[note.accidental]}
              </text>
            )}
            {/* Notehead */}
            <text
              id={noteId}
              x={nx}
              y={ny}
              fill={inkColor}
              text-anchor="middle"
              font-size={fontSize}
            >
              {G.noteheadBlack}
            </text>
            {/* Ledger lines */}
            {ledgerLineYs(note.pitch, clef, staffBottomY, staffSpace).map(
              (ly) => (
                <line
                  key={ly}
                  x1={nx - nrx - 3}
                  x2={nx + nrx + 3}
                  y1={ly}
                  y2={ly}
                  stroke={inkColor}
                  stroke-width="0.8"
                />
              ),
            )}
            {/* Stem (upward) */}
            <line
              x1={stemX}
              x2={stemX}
              y1={ny}
              y2={stemTipY}
              stroke={inkColor}
              stroke-width="1"
            />
            {/* Flag — omitted when the group belongs to a beamed run */}
            {showFlag && (
              <text
                x={stemX}
                y={stemTipY}
                text-anchor="start"
                fill={inkColor}
                font-size={fontSize}
              >
                {G.flag8thUp}
              </text>
            )}
            {/* Acciaccatura slash */}
            {slash && (
              <line
                x1={stemX - 4}
                x2={stemX + 4}
                y1={stemTipY + stemLength * 0.6}
                y2={stemTipY - 3}
                stroke={inkColor}
                stroke-width="1"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

// ── Chord Group ───────────────────────────────────────────────────────────────

interface ChordGroupElProps {
  group: ChordGroup;
  x: number;
  staffBottomY: number;
  clef: { sign: "G" | "F"; line: number };
  partIndex: number;
  measureNumber: number;
  staffSpace: number;
  inkColor: string;
  /** When set, this note is part of a beam group: use the given stem direction
   *  and extend the stem to stemTipY instead of the default length. No flag
   *  is rendered — the beam line is drawn by BeamLines instead. */
  beamStemOverride?: { stemDir: "up" | "down"; stemTipY: number };
}

// Compute per-note x offsets within a chord to displace adjacent seconds.
// Notes must already be sorted low→high. For stem-up, displaced notes shift
// right (2×nrx); for stem-down they shift left. Cascading seconds alternate
// sides: C-D-E → C normal, D displaced, E normal.
function chordXOffsets(
  notes: ParsedNote[],
  stemDir: "up" | "down",
  nrx: number,
): number[] {
  const offsets = new Array(notes.length).fill(0);
  for (let i = 1; i < notes.length; i++) {
    const stepDiff =
      diatonicIndex(notes[i].pitch) - diatonicIndex(notes[i - 1].pitch);
    if (stepDiff === 1 && offsets[i - 1] === 0) {
      offsets[i] = stemDir === "up" ? nrx * 2 : -(nrx * 2);
    }
  }
  return offsets;
}

// All props are primitives or references that stay stable while the score and
// layout are unchanged (group/clef come from the memoized score,
// beamStemOverride from the memoized per-measure map), so the default shallow
// memo comparator is sufficient. Note colors are no longer threaded through
// here — they are drawn separately by NoteColorOverlay.
const ChordGroupEl = memo(function ChordGroupEl({
  group,
  x,
  staffBottomY,
  clef,
  partIndex,
  measureNumber,
  staffSpace,
  inkColor,
  beamStemOverride,
}: ChordGroupElProps) {
  const { type, notes, gracesBefore } = group;
  const N = gracesBefore?.length ?? 0;
  const hasNoStem = type === "whole";

  const stemDir = beamStemOverride?.stemDir ?? stemDirection(group, clef);
  const noteGeom = chordNoteGeometry(
    group,
    x,
    partIndex,
    measureNumber,
    clef,
    staffBottomY,
    staffSpace,
    stemDir,
  );
  const noteYs = noteGeom.map((n) => n.ny);
  const topY = Math.min(...noteYs);
  const bottomY = Math.max(...noteYs);
  const stemLength = staffSpace * 3;
  const nrx = staffSpace * 0.55;

  // Grace note geometry — proportional to the smaller grace scale.
  const graceScale = GRACE_FONT_FACTOR / 4;
  const graceNrx = staffSpace * 0.55 * graceScale; // grace notehead half-width
  const graceStemLength = staffSpace * 2.0;
  const isGraceBeamed = N > 1;
  // When the main chord has accidentals, push grace notes further left so
  // the grace stem/flag doesn't overlap the accidental glyph.
  const mainAccWidth = notes.some((n) => n.accidental !== "none")
    ? staffSpace * ACCIDENTAL_BASE_OFFSET_FACTOR
    : 0;
  // Absolute x for each grace group; index 0 = leftmost.
  const graceXs = Array.from(
    { length: N },
    (_, gi) => x - mainAccWidth - (N - gi) * GRACE_NOTE_ADVANCE,
  );
  // When beaming multiple grace groups, compute a diagonal beam from the first
  // to the last note's natural stem tip (same slope logic as regular beams).
  let graceStemTipYs: number[] | undefined;
  if (isGraceBeamed && gracesBefore) {
    // Natural stem tip for each grace group (top note → stem goes up).
    const naturalTipYs = gracesBefore.map((gg) => {
      const topNote = gg.notes[gg.notes.length - 1];
      return (
        noteY(topNote.pitch, clef, staffBottomY, staffSpace) - graceStemLength
      );
    });
    const maxBeamRise = staffSpace * 1.5;
    const rawRise = naturalTipYs[naturalTipYs.length - 1] - naturalTipYs[0];
    const clampedRise = Math.max(-maxBeamRise, Math.min(maxBeamRise, rawRise));
    const dX = graceXs[graceXs.length - 1] - graceXs[0];
    const slope = dX === 0 ? 0 : clampedRise / dX;
    graceStemTipYs = graceXs.map(
      (gx) => naturalTipYs[0] + slope * (gx - graceXs[0]),
    );
  }

  // A staccato chord gets a single dot on the outer notehead away from the
  // stem (below the lowest note for stem-up, above the highest for stem-down),
  // not one dot per note. noteGeom is sorted low→high.
  const staccatoDot = notes.some((n) => n.staccato)
    ? stemDir === "up"
      ? { x: noteGeom[0].nx, y: bottomY + staffSpace }
      : { x: noteGeom[noteGeom.length - 1].nx, y: topY - staffSpace }
    : null;

  let stemX: number;
  let stemY1: number;
  let stemY2: number;
  if (stemDir === "up") {
    stemX = x + nrx;
    stemY1 = bottomY;
    stemY2 = beamStemOverride?.stemTipY ?? topY - stemLength;
  } else {
    stemX = x - nrx;
    stemY1 = topY;
    stemY2 = beamStemOverride?.stemTipY ?? bottomY + stemLength;
  }

  return (
    <g data-chord-id={`p${partIndex}-m${measureNumber}-n${group.noteIndex}`}>
      {/* Grace notes rendered to the left of the main chord */}
      {gracesBefore?.map((gg, gi) => (
        <GraceNoteGroupEl
          key={gg.noteIndex}
          graceGroup={gg}
          x={graceXs[gi]}
          staffBottomY={staffBottomY}
          clef={clef}
          partIndex={partIndex}
          measureNumber={measureNumber}
          staffSpace={staffSpace}
          inkColor={inkColor}
          showFlag={!isGraceBeamed}
          stemTipOverride={graceStemTipYs?.[gi]}
        />
      ))}
      {/* Beam bar connecting multiple grace note groups */}
      {isGraceBeamed && graceStemTipYs !== undefined && (
        <line
          x1={graceXs[0] + graceNrx}
          x2={graceXs[N - 1] + graceNrx}
          y1={graceStemTipYs[0]}
          y2={graceStemTipYs[N - 1]}
          stroke={inkColor}
          stroke-width={staffSpace * 0.5 * graceScale}
        />
      )}
      {!hasNoStem && (
        <line
          x1={stemX}
          x2={stemX}
          y1={stemY1}
          y2={stemY2}
          stroke={inkColor}
          stroke-width="1.2"
        />
      )}
      {!hasNoStem &&
        (type === "eighth" || type === "16th") &&
        !beamStemOverride && (
          <Flags
            type={type}
            stemDir={stemDir}
            stemX={stemX}
            stemTipY={stemY2}
            inkColor={inkColor}
          />
        )}
      {noteGeom.map((info, v) => {
        const { nx, ny } = info;
        return (
          <g key={info.id}>
            <Notehead
              x={nx}
              y={ny}
              type={type}
              id={info.id}
              color={inkColor}
              accidental={info.accidental}
              accidentalX={info.accidentalX}
              staffSpace={staffSpace}
            />
            {ledgerLineYs(notes[v].pitch, clef, staffBottomY, staffSpace).map(
              (ly) => (
                <line
                  key={ly}
                  x1={nx - nrx - 4}
                  x2={nx + nrx + 4}
                  y1={ly}
                  y2={ly}
                  stroke={inkColor}
                  stroke-width="1"
                />
              ),
            )}
            {info.dot && (
              <circle
                cx={nx + nrx + 4}
                cy={ny - staffSpace / 4}
                r={1.5}
                fill={inkColor}
              />
            )}
          </g>
        );
      })}
      {staccatoDot && (
        <circle cx={staccatoDot.x} cy={staccatoDot.y} r={1.6} fill={inkColor} />
      )}
    </g>
  );
});

// ── Flags ─────────────────────────────────────────────────────────────────────

function Flags({
  type,
  stemDir,
  stemX,
  stemTipY,
  inkColor,
}: {
  type: NoteType;
  stemDir: "up" | "down";
  stemX: number;
  stemTipY: number;
  inkColor: string;
}) {
  const char =
    stemDir === "up"
      ? type === "16th"
        ? G.flag16thUp
        : G.flag8thUp
      : type === "16th"
        ? G.flag16thDown
        : G.flag8thDown;
  return (
    <text x={stemX} y={stemTipY} text-anchor="start" fill={inkColor}>
      {char}
    </text>
  );
}

// ── Notehead ──────────────────────────────────────────────────────────────────

const ACCIDENTAL_GLYPH: Record<AccidentalKind, string> = {
  none: "",
  sharp: G.accSharp,
  flat: G.accFlat,
  natural: G.accNatural,
};

function Notehead({
  x,
  y,
  type,
  id,
  color,
  accidental,
  accidentalX,
  staffSpace,
}: {
  x: number;
  y: number;
  type: NoteType;
  id?: string;
  color: string;
  accidental: AccidentalKind;
  /** Absolute x for the accidental glyph. Defaults to the standard offset. */
  accidentalX?: number;
  staffSpace: number;
}) {
  const char =
    type === "whole"
      ? G.noteheadWhole
      : type === "half"
        ? G.noteheadHalf
        : G.noteheadBlack;

  const accX = accidentalX ?? x - staffSpace * 1.4;

  return (
    <g>
      {accidental !== "none" && (
        <text x={accX} y={y} fill={color} text-anchor="middle">
          {ACCIDENTAL_GLYPH[accidental]}
        </text>
      )}
      <text id={id} x={x} y={y} fill={color} text-anchor="middle">
        {char}
      </text>
    </g>
  );
}

// ── Beam Lines ────────────────────────────────────────────────────────────────

function BeamLines({
  beamGroups,
  staffSpace,
  inkColor,
}: {
  beamGroups: BeamGroupData[];
  staffSpace: number;
  inkColor: string;
}) {
  const beamThickness = staffSpace * 0.5;
  // Gap between primary and secondary beam: beam thickness + small clearance
  const beamOffset = beamThickness + staffSpace * 0.25;

  return (
    <g>
      {beamGroups.map((group) => {
        const { eventIndices, stems, beamStartY, beamEndY, stemDir, types } =
          group;
        const x1 = stems[0].stemX;
        const x2 = stems[stems.length - 1].stemX;
        const secSegments = secondaryBeamSegments(
          types,
          stems,
          beamOffset,
          stemDir,
        );
        // Use first event index as stable key — unique within a measure.
        const groupKey = eventIndices[0];

        return (
          <g key={groupKey}>
            <line
              x1={x1}
              x2={x2}
              y1={beamStartY}
              y2={beamEndY}
              stroke={inkColor}
              stroke-width={beamThickness}
            />
            {secSegments.map((seg) => (
              <line
                key={seg.x1}
                x1={seg.x1}
                x2={seg.x2}
                y1={seg.y1}
                y2={seg.y2}
                stroke={inkColor}
                stroke-width={beamThickness}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

// ── Rest ──────────────────────────────────────────────────────────────────────

function RestEl({
  rest,
  x,
  staffBottomY,
  staffSpace,
  inkColor,
}: {
  rest: ParsedRest;
  x: number;
  staffBottomY: number;
  staffSpace: number;
  inkColor: string;
}) {
  const { type, fullMeasure } = rest;
  const effectiveType = fullMeasure ? "whole" : type;

  const char =
    effectiveType === "whole"
      ? G.restWhole
      : effectiveType === "half"
        ? G.restHalf
        : effectiveType === "quarter"
          ? G.restQuarter
          : effectiveType === "eighth"
            ? G.rest8th
            : G.rest16th;

  return (
    <text
      x={x}
      y={staffBottomY - 2 * staffSpace}
      text-anchor="middle"
      fill={inkColor}
    >
      {char}
    </text>
  );
}
