import { useMemo } from "preact/hooks";
import { diatonicIndex, isRest, parseScore } from "./musicxml-parser";
import {
  FLAT_POSITIONS,
  SHARP_POSITIONS,
  eventXPositions,
  headerWidth,
  ledgerLineYs,
  noteY,
  resolveLayout,
  stemDirection,
} from "./sheet-music-layout";
import type {
  ChordGroup,
  LayoutConfig,
  NoteType,
  ParsedMeasure,
  ParsedNote,
  ParsedPart,
  ParsedRest,
  ParsedScore,
  ResolvedLayout,
} from "./sheet-music-types";

// ── Bravura / SMuFL glyph constants ──────────────────────────────────────────

const BRAVURA = "Bravura, serif";

// SMuFL Private Use Area codepoints, all designed for font-size = 4 × staff-space.
// Baseline sits at the bottom staff line (y = staffBottomY in our coordinate system).
const G = {
  gClef:         "",
  fClef:         "",
  accSharp:      "",
  accFlat:       "",
  noteheadWhole: "",
  noteheadHalf:  "",
  noteheadBlack: "",
  restWhole:     "",
  restHalf:      "",
  restQuarter:   "",
  rest8th:       "",
  rest16th:      "",
  flag8thUp:     "",
  flag8thDown:   "",
  flag16thUp:    "",
  flag16thDown:  "",
} as const;

// ── Public API ────────────────────────────────────────────────────────────────

interface SheetMusicDisplayProps {
  musicxml: string;
  layout?: LayoutConfig;
  noteColors?: Record<string, string>;
  visibleParts?: Set<string>;
}

export function SheetMusicDisplay({
  musicxml,
  layout: layoutConfig,
  noteColors = {},
  visibleParts,
}: SheetMusicDisplayProps) {
  const result = useMemo(() => {
    try {
      const score = parseScore(musicxml);
      const layout = resolveLayout(score, layoutConfig);
      return { score, layout, error: null };
    } catch (e) {
      return { score: null, layout: null, error: String(e) };
    }
  }, [musicxml, layoutConfig]);

  if (result.error) {
    return <p style="color:red">{result.error}</p>;
  }
  if (!result.score || !result.layout) {
    return null;
  }
  const { score, layout } = result;
  if (score.parts.length === 0 || score.numMeasures === 0) {
    return <p>No music to display.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={layout.totalWidth}
        height={layout.totalHeight}
        style={{ display: "block" }}
        role="img"
        aria-label="Sheet music"
      >
        {score.parts.map((part, p) => (
          <Staff
            key={part.id}
            part={part}
            partIndex={p}
            layout={layout}
            staffBottomY={layout.staffBottomYs[p]}
            noteColors={noteColors}
            visible={visibleParts ? visibleParts.has(part.id) : true}
          />
        ))}
      </svg>
    </div>
  );
}

// ── Staff ─────────────────────────────────────────────────────────────────────

interface StaffProps {
  part: ParsedPart;
  partIndex: number;
  layout: ResolvedLayout;
  staffBottomY: number;
  noteColors: Record<string, string>;
  visible: boolean;
}

function Staff({
  part,
  partIndex,
  layout,
  staffBottomY,
  noteColors,
  visible,
}: StaffProps) {
  const { sls, totalWidth, measureXs, measureWidths } = layout;
  return (
    <g visibility={visible ? "visible" : "hidden"}>
      <StaffLines
        totalWidth={totalWidth}
        staffBottomY={staffBottomY}
        sls={sls}
      />
      {part.measures.map((measure, m) => (
        <Measure
          key={measure.number}
          measure={measure}
          measureIndex={m}
          partIndex={partIndex}
          clef={part.clef}
          keySig={part.keySig}
          isFirstMeasure={m === 0}
          x={measureXs[m]}
          staffBottomY={staffBottomY}
          layout={layout}
          noteColors={noteColors}
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
          sls={sls}
        />
      )}
    </g>
  );
}

// ── Staff Lines ───────────────────────────────────────────────────────────────

function StaffLines({
  totalWidth,
  staffBottomY,
  sls,
}: { totalWidth: number; staffBottomY: number; sls: number }) {
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = staffBottomY - i * sls;
        return (
          <line
            key={i}
            x1={0}
            x2={totalWidth}
            y1={y}
            y2={y}
            stroke="black"
            stroke-width="1"
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
  sls,
}: { x: number; staffBottomY: number; sls: number }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={staffBottomY - 4 * sls}
      y2={staffBottomY}
      stroke="black"
      stroke-width="1.5"
    />
  );
}

// ── Measure ───────────────────────────────────────────────────────────────────

interface MeasureProps {
  measure: ParsedMeasure;
  measureIndex: number;
  partIndex: number;
  clef: { sign: "G" | "F"; line: number };
  keySig: { fifths: number; mode: string };
  isFirstMeasure: boolean;
  x: number;
  staffBottomY: number;
  layout: ResolvedLayout;
  noteColors: Record<string, string>;
}

function Measure({
  measure,
  measureIndex: _measureIndex,
  partIndex,
  clef,
  keySig,
  isFirstMeasure,
  x,
  staffBottomY,
  layout,
  noteColors,
}: MeasureProps) {
  const { sls, noteUnitWidth } = layout;
  const eventXs = eventXPositions(
    measure.events,
    x,
    isFirstMeasure,
    keySig.fifths,
    noteUnitWidth,
  );

  const hdrWidth = isFirstMeasure ? headerWidth(keySig.fifths) : 0;
  const clefX = x + 2;
  const keySigX = clefX + 32;
  const timeSigX = keySigX + Math.abs(keySig.fifths) * 10;

  return (
    <g>
      <Barline x={x} staffBottomY={staffBottomY} sls={sls} />
      {isFirstMeasure && (
        <>
          <Clef clef={clef} x={clefX} staffBottomY={staffBottomY} sls={sls} />
          <KeySig
            keySig={keySig}
            clef={clef}
            x={keySigX}
            staffBottomY={staffBottomY}
            sls={sls}
          />
          <TimeSig
            timeSig={measure.timeSig ?? { beats: 4, beatType: 4 }}
            x={timeSigX}
            staffBottomY={staffBottomY}
            sls={sls}
          />
        </>
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
                sls={sls}
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
              noteColors={noteColors}
              sls={sls}
            />
          );
        });
      })()}
    </g>
  );
}

// ── Clef ──────────────────────────────────────────────────────────────────────

function Clef({
  clef,
  x,
  staffBottomY,
  sls,
}: {
  clef: { sign: "G" | "F" };
  x: number;
  staffBottomY: number;
  sls: number;
}) {
  const char = clef.sign === "G" ? G.gClef : G.fClef;
  return (
    <text
      x={x + 2}
      y={staffBottomY}
      font-size={sls * 4}
      font-family={BRAVURA}
    >
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
  sls,
}: {
  keySig: { fifths: number };
  clef: { sign: "G" | "F" };
  x: number;
  staffBottomY: number;
  sls: number;
}) {
  const { fifths } = keySig;
  if (fifths === 0) return null;

  const positions =
    fifths > 0
      ? SHARP_POSITIONS[clef.sign].slice(0, fifths)
      : FLAT_POSITIONS[clef.sign].slice(0, -fifths);
  const symbol = fifths > 0 ? G.accSharp : G.accFlat;
  const spacing = sls * 1.1;

  return (
    <g>
      {positions.map((pitch, i) => {
        const y = noteY(pitch, clef, staffBottomY, sls);
        return (
          <text
            key={`${pitch.step}${pitch.octave}`}
            x={x + i * spacing}
            y={y}
            font-size={sls * 4}
            font-family={BRAVURA}
            text-anchor="middle"
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
  sls,
}: {
  timeSig: { beats: number; beatType: number };
  x: number;
  staffBottomY: number;
  sls: number;
}) {
  const centerX = x + 10;
  const fontSize = sls * 2;
  return (
    <g>
      <text
        x={centerX}
        y={staffBottomY - sls * 3}
        font-size={fontSize}
        font-family="serif"
        font-weight="bold"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {timeSig.beats}
      </text>
      <text
        x={centerX}
        y={staffBottomY - sls * 1}
        font-size={fontSize}
        font-family="serif"
        font-weight="bold"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {timeSig.beatType}
      </text>
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
  noteColors: Record<string, string>;
  sls: number;
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

function ChordGroupEl({
  group,
  x,
  staffBottomY,
  clef,
  partIndex,
  measureNumber,
  noteColors,
  sls,
}: ChordGroupElProps) {
  const { type, notes, noteIndex, dot } = group;
  const hasNoStem = type === "whole";

  const noteYs = notes.map((n) => noteY(n.pitch, clef, staffBottomY, sls));
  const topY = Math.min(...noteYs);
  const bottomY = Math.max(...noteYs);
  const stemDir = stemDirection(group, clef);
  const stemLength = sls * 3;
  const nrx = sls * 0.55;
  const xOffsets = chordXOffsets(notes, stemDir, nrx);

  let stemX: number;
  let stemY1: number;
  let stemY2: number;
  if (stemDir === "up") {
    stemX = x + nrx;
    stemY1 = bottomY;
    stemY2 = topY - stemLength;
  } else {
    stemX = x - nrx;
    stemY1 = topY;
    stemY2 = bottomY + stemLength;
  }

  return (
    <g data-chord-id={`p${partIndex}-m${measureNumber}-n${noteIndex}`}>
      {!hasNoStem && (
        <line
          x1={stemX}
          x2={stemX}
          y1={stemY1}
          y2={stemY2}
          stroke="black"
          stroke-width="1.2"
        />
      )}
      {!hasNoStem && (type === "eighth" || type === "16th") && (
        <Flags type={type} stemDir={stemDir} stemX={stemX} stemTipY={stemY2} sls={sls} />
      )}
      {notes.map((note, v) => {
        const ny = noteYs[v];
        const nx = x + xOffsets[v];
        const id = `p${partIndex}-m${measureNumber}-n${noteIndex}-v${v}`;
        const color = noteColors[id] ?? "black";
        return (
          <g key={id}>
            <Notehead
              x={nx}
              y={ny}
              type={type}
              id={id}
              color={color}
              showAccidental={note.showAccidental}
              sls={sls}
            />
            {ledgerLineYs(note.pitch, clef, staffBottomY, sls).map((ly) => (
              <line
                key={ly}
                x1={nx - nrx - 4}
                x2={nx + nrx + 4}
                y1={ly}
                y2={ly}
                stroke="black"
                stroke-width="1"
              />
            ))}
            {dot && (
              <circle
                cx={nx + nrx + 4}
                cy={ny - sls / 4}
                r={1.5}
                fill={color}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

// ── Flags ─────────────────────────────────────────────────────────────────────

function Flags({
  type,
  stemDir,
  stemX,
  stemTipY,
  sls,
}: {
  type: NoteType;
  stemDir: "up" | "down";
  stemX: number;
  stemTipY: number;
  sls: number;
}) {
  const char =
    stemDir === "up"
      ? (type === "16th" ? G.flag16thUp : G.flag8thUp)
      : (type === "16th" ? G.flag16thDown : G.flag8thDown);
  return (
    <text
      x={stemX}
      y={stemTipY}
      font-size={sls * 4}
      font-family={BRAVURA}
      text-anchor="start"
    >
      {char}
    </text>
  );
}

// ── Notehead ──────────────────────────────────────────────────────────────────

function Notehead({
  x,
  y,
  type,
  id,
  color,
  showAccidental,
  sls,
}: {
  x: number;
  y: number;
  type: NoteType;
  id: string;
  color: string;
  showAccidental: boolean;
  sls: number;
}) {
  const char =
    type === "whole" ? G.noteheadWhole :
    type === "half"  ? G.noteheadHalf :
    G.noteheadBlack;

  return (
    <g>
      {showAccidental && (
        <text
          x={x - sls * 1.4}
          y={y}
          font-size={sls * 4}
          font-family={BRAVURA}
          fill={color}
          text-anchor="middle"
        >
          {G.accSharp}
        </text>
      )}
      <text
        id={id}
        x={x}
        y={y}
        font-size={sls * 4}
        font-family={BRAVURA}
        fill={color}
        text-anchor="middle"
      >
        {char}
      </text>
    </g>
  );
}

// ── Rest ──────────────────────────────────────────────────────────────────────

function RestEl({
  rest,
  x,
  staffBottomY,
  sls,
}: {
  rest: ParsedRest;
  x: number;
  staffBottomY: number;
  sls: number;
}) {
  const { type, fullMeasure } = rest;
  const effectiveType = fullMeasure ? "whole" : type;

  const char =
    effectiveType === "whole"   ? G.restWhole :
    effectiveType === "half"    ? G.restHalf :
    effectiveType === "quarter" ? G.restQuarter :
    effectiveType === "eighth"  ? G.rest8th :
    G.rest16th;

  return (
    <text
      x={x}
      y={staffBottomY}
      font-size={sls * 4}
      font-family={BRAVURA}
      text-anchor="middle"
    >
      {char}
    </text>
  );
}
