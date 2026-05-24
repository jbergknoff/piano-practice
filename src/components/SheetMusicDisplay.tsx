import { memo } from "preact/compat";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  diatonicIndex,
  isRest,
  parseScore,
} from "../../lib/musicxml/musicxml-parser";
import {
  ACCIDENTAL_BASE_OFFSET_FACTOR,
  ACCIDENTAL_COLUMN_WIDTH_FACTOR,
  DIVISIONS,
  FLAT_POSITIONS,
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
} from "../../lib/musicxml/sheet-music-layout";
import type {
  AccidentalKind,
  ChordGroup,
  LayoutConfig,
  MeasureEvent,
  NoteType,
  ParsedMeasure,
  ParsedNote,
  ParsedPart,
  ParsedRest,
  ParsedScore,
  ResolvedLayout,
} from "../../lib/musicxml/sheet-music-types";

// ── Bravura / SMuFL glyph constants ──────────────────────────────────────────

const BRAVURA = "Bravura, serif";

// SMuFL glyphs live in Unicode's Private Use Area (U+E000–U+F8FF) and are only
// meaningful when rendered with a SMuFL font such as Bravura.  Each glyph is
// designed for font-size = 4 × staff-space, with its baseline at the bottom
// staff line (y = staffBottomY in our SVG coordinate system).
const G = {
  gClef: "\uE050",
  fClef: "\uE062",
  accSharp: "\uE262",
  accFlat: "\uE260",
  accNatural: "\uE261",
  noteheadWhole: "\uE0A2",
  noteheadHalf: "\uE0A3",
  noteheadBlack: "\uE0A4",
  restWhole: "\uE4E3",
  restHalf: "\uE4E4",
  restQuarter: "\uE4E5",
  rest8th: "\uE4E6",
  rest16th: "\uE4E7",
  flag8thUp: "\uE240",
  flag8thDown: "\uE241",
  flag16thUp: "\uE242",
  flag16thDown: "\uE243",
} as const;

// ── Beam geometry ─────────────────────────────────────────────────────────────

interface BeamGroupData {
  eventIndices: number[];
  stemDir: "up" | "down";
  /** Y coordinate of the primary (outermost) beam line */
  beamY: number;
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
  const nrx = staffSpace * 0.55;

  return groupBeamableEvents(events, beatDivisions).map((indices) => {
    const chords = indices.map((i) => events[i] as ChordGroup);
    const stemDir = beamStemDirection(chords, clef);

    // Candidate stem-tip Y using the standard stem length for each chord.
    const candidateTipYs = chords.map((g) => {
      const ys = g.notes.map((n) =>
        noteY(n.pitch, clef, staffBottomY, staffSpace),
      );
      const topY = Math.min(...ys);
      const bottomY = Math.max(...ys);
      return stemDir === "up" ? topY - stemLength : bottomY + stemLength;
    });

    // Flat beam: set beam Y so every stem is at least stemLength long.
    const beamY =
      stemDir === "up"
        ? Math.min(...candidateTipYs)
        : Math.max(...candidateTipYs);

    const stems = chords.map((_, j) => ({
      stemX:
        stemDir === "up"
          ? eventXs[indices[j]] + nrx
          : eventXs[indices[j]] - nrx,
      stemTipY: beamY,
    }));

    return {
      eventIndices: indices,
      stemDir,
      beamY,
      stems,
      types: chords.map((g) => g.type),
    };
  });
}

// Compute secondary beam segments for 16th notes within a beam group.
// Returns x-spans to draw at the secondary beam Y.
function secondaryBeamSegments(
  types: NoteType[],
  stems: Array<{ stemX: number }>,
): Array<{ x1: number; x2: number }> {
  const segments: Array<{ x1: number; x2: number }> = [];
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
      // Isolated 16th: half-stub toward nearest neighbor
      const idx = runStart;
      if (idx > 0) {
        const halfGap = (stems[idx].stemX - stems[idx - 1].stemX) / 2;
        segments.push({
          x1: stems[idx].stemX - halfGap,
          x2: stems[idx].stemX,
        });
      } else {
        const halfGap =
          ((stems[idx + 1]?.stemX ?? stems[idx].stemX + 10) -
            stems[idx].stemX) /
          2;
        segments.push({
          x1: stems[idx].stemX,
          x2: stems[idx].stemX + halfGap,
        });
      }
    } else {
      segments.push({
        x1: stems[runStart].stemX,
        x2: stems[runEnd - 1].stemX,
      });
    }
  }
  return segments;
}

// ── Cursor position helper ────────────────────────────────────────────────────

function computeCursorX(
  beat: number,
  score: ParsedScore,
  layout: ResolvedLayout,
): number | null {
  const timeSig = score.parts[0]?.timeSig ?? { beats: 4, beatType: 4 };
  // Convert beat (in quarter notes) to beat count in the time signature's unit
  const beatsPerMeasure = timeSig.beats * (4 / timeSig.beatType);
  const measureIndex = Math.floor(beat / beatsPerMeasure);
  const beatInMeasure = beat % beatsPerMeasure;

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
      });
    });
  });

  return infos;
}

// Renders colored notehead glyphs on top of the ink notes. Only the notes
// present in noteColors are drawn, so this re-renders cheaply (a handful of
// glyphs) while the heavyweight note tree below never re-renders on color
// changes. Memoized on [infos, noteColors] — noteColors identity is stabilized
// upstream so this skips entirely when the active set is unchanged.
const NoteColorOverlay = memo(function NoteColorOverlay({
  infos,
  noteColors,
}: {
  infos: Map<string, NoteRenderInfo>;
  noteColors: Record<string, string>;
}) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {Object.entries(noteColors).map(([id, color]) => {
        const info = infos.get(id);
        if (!info) {
          return null;
        }
        const nrx = info.staffSpace * 0.55;
        return (
          <g key={id}>
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

interface SheetMusicDisplayProps {
  musicxml: string;
  layout?: LayoutConfig;
  noteColors?: Record<string, string>;
  visibleParts?: Set<string>;
  /** Accent color used for the focus-range handles. Defaults to blue (#1976d2). */
  accentColor?: string;
  /** Override the SMuFL glyph font-size. Defaults to 4 × the layout staff-space. */
  glyphFontSize?: number;
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
}

export function SheetMusicDisplay({
  musicxml,
  layout: layoutConfig,
  noteColors = {},
  visibleParts,
  accentColor = "#1976d2",
  glyphFontSize,
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

  // Per-note geometry for the color overlay. Depends only on score + layout, so
  // it is computed once per piece and never on color changes.
  const noteInfos = useMemo(
    () => computeNoteRenderInfos(score, layout),
    [score, layout],
  );

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
      const x = beat !== null ? computeCursorX(beat, score, layout) : null;
      if (x !== null && containerWidth > 0) {
        const screenX = leftPad + x - currentScroll;
        if (screenX < 0 || screenX > containerWidth * 0.78) {
          currentScroll = Math.max(0, leftPad + x - containerWidth * 0.38);
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
  }, [getLiveBeat, isPlaying, score, layout, placeCursor]);

  // When not playing (paused, stopped, initial load) the cursor is static, so
  // position it once here instead of burning a rAF loop. Re-runs on pause/stop
  // and after every jump (snapGeneration) so seeks/resets move it immediately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapGeneration drives re-fire after jumps; score/layout compute position
  useEffect(() => {
    if (!getLiveBeat || isPlaying) {
      return;
    }
    const beat = getLiveBeat();
    placeCursor(beat !== null ? computeCursorX(beat, score, layout) : null);
  }, [getLiveBeat, isPlaying, snapGeneration, score, layout, placeCursor]);

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
    const x = computeCursorX(beat, score, layout);
    const leftPad = Number.parseFloat(getComputedStyle(el).paddingLeft) || 0;
    el.scrollLeft =
      x !== null ? Math.max(0, leftPad + x - el.clientWidth * 0.38) : 0;
  }, [snapGeneration, score, layout]);

  // Focus handle drag state — ref tracks the live value between renders, state
  // drives visual feedback.
  const svgRef = useRef<SVGSVGElement>(null);
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
        onSheetContextMenu({
          measureNumber: measureIndex + 1,
          beat: (measureIndex + frac) * beatsPerMeasure,
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
            fontFamily: BRAVURA,
            fontSize: fontSize,
          }}
          role="img"
          aria-label="Sheet music"
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
            />
          ))}
          <NoteColorOverlay infos={noteInfos} noteColors={noteColors} />
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
            />
          </>
        )}
        {getLiveBeat && (
          <div
            ref={cursorDivRef}
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
}

const Staff = memo(function Staff({
  part,
  partIndex,
  layout,
  staffBottomY,
  visible,
  inkColor,
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
          font-family="Geist, ui-sans-serif, system-ui, sans-serif"
          fill={inkColor}
          fill-opacity={0.38}
        >
          {measure.number}
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
  const fontSize = staffSpace * 2;
  return (
    <g fill={inkColor}>
      <text
        x={centerX}
        y={staffBottomY - staffSpace * 3}
        font-size={fontSize}
        font-family="Fraunces, serif"
        font-weight="700"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {timeSig.beats}
      </text>
      <text
        x={centerX}
        y={staffBottomY - staffSpace * 1}
        font-size={fontSize}
        font-family="Fraunces, serif"
        font-weight="700"
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
  const { type, notes } = group;
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
        const { eventIndices, stems, beamY, stemDir, types } = group;
        const x1 = stems[0].stemX;
        const x2 = stems[stems.length - 1].stemX;
        // Secondary beam sits closer to the noteheads than the primary beam.
        const beam2Y =
          stemDir === "up" ? beamY + beamOffset : beamY - beamOffset;
        const secSegments = secondaryBeamSegments(types, stems);
        // Use first event index as stable key — unique within a measure.
        const groupKey = eventIndices[0];

        return (
          <g key={groupKey}>
            <line
              x1={x1}
              x2={x2}
              y1={beamY}
              y2={beamY}
              stroke={inkColor}
              stroke-width={beamThickness}
            />
            {secSegments.map((seg) => (
              <line
                key={seg.x1}
                x1={seg.x1}
                x2={seg.x2}
                y1={beam2Y}
                y2={beam2Y}
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
