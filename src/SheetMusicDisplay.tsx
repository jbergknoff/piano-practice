import { forwardRef, memo, useImperativeHandle } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { diatonicIndex, isRest, parseScore } from "./musicxml-parser";
import {
  DIVISIONS,
  FLAT_POSITIONS,
  MIN_EVENT_ADVANCE,
  SHARP_POSITIONS,
  beamStemDirection,
  eventXPositions,
  groupBeamableEvents,
  headerWidth,
  ledgerLineYs,
  noteY,
  resolveLayout,
  stemDirection,
} from "./sheet-music-layout";
import type {
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
} from "./sheet-music-types";

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

function computeBeamGroups(
  events: MeasureEvent[],
  eventXs: number[],
  clef: { sign: "G" | "F"; line: number },
  staffBottomY: number,
  staffSpace: number,
): BeamGroupData[] {
  const stemLength = staffSpace * 3;
  const nrx = staffSpace * 0.55;

  return groupBeamableEvents(events).map((indices) => {
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

  if (measureIndex >= layout.measureXs.length) {
    return null;
  }

  const measure = score.parts[0]?.measures[measureIndex];
  if (!measure) {
    return null;
  }

  const isFirst = measureIndex === 0;
  const fifths = score.parts[0]?.keySig?.fifths ?? 0;
  const eventXs = eventXPositions(
    measure.events,
    layout.measureXs[measureIndex],
    isFirst,
    fifths,
    layout.noteUnitWidth,
    layout.staffSpace,
  );

  // Walk through measure events to find the X position for the current beat.
  // Duration in MusicXML divisions; 4 divisions = 1 quarter note.
  const divisionsPerBeat = DIVISIONS * (4 / timeSig.beatType);
  const targetDiv = beatInMeasure * divisionsPerBeat;
  const barlineX = layout.measureXs[measureIndex];
  const endBarlineX = barlineX + layout.measureWidths[measureIndex];

  let acc = 0;
  for (let i = 0; i < measure.events.length; i++) {
    const event = measure.events[i];
    const dur = isRest(event) ? event.duration : (event as ChordGroup).duration;

    if (acc + dur > targetDiv) {
      const frac = (targetDiv - acc) / dur;
      // Interpolate between adjacent anchors so the cursor is always continuous:
      //   i=0  starts at barlineX (matches end of previous measure)
      //   i>0  starts at eventXs[i]
      //   all  end at the next note's X, or the closing barline for the last event
      const x0 = i === 0 ? barlineX : eventXs[i];
      const x1 = i + 1 < eventXs.length ? eventXs[i + 1] : endBarlineX;
      return x0 + frac * (x1 - x0);
    }
    acc += dur;
  }

  return endBarlineX;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type SheetMusicHandle = {
  setCursorBeat(beat: number | undefined): void;
};

interface SheetMusicDisplayProps {
  musicxml: string;
  layout?: LayoutConfig;
  noteColors?: Record<string, string>;
  visibleParts?: Set<string>;
  /** Color of the playback cursor line. Defaults to blue (#1976d2). */
  cursorColor?: string;
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
   *  computeCursorX, and clears the ref. Using the beat directly (rather
   *  than cursorX) means the snap works even when playbackBeat is undefined
   *  (e.g. beat 0 in listen mode) and fires even if cursorX did not change. */
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
}

export const SheetMusicDisplay = memo(
  forwardRef<SheetMusicHandle, SheetMusicDisplayProps>(
    function SheetMusicDisplay(
      {
        musicxml,
        layout: layoutConfig,
        noteColors = {},
        visibleParts,
        cursorColor = "#1976d2",
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
      }: SheetMusicDisplayProps,
      ref,
    ) {
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

      const fontSize = glyphFontSize ?? layout.staffSpace * 4;

      const containerRef = useRef<HTMLDivElement>(null);
      const cursorLineRef = useRef<SVGLineElement>(null);
      const scrollTargetRef = useRef<number | null>(null);
      const scrollRafRef = useRef<number | null>(null);
      // Set true when the user manually scrolls; suppresses cursor-following until
      // a snap or until the cursor scrolls back into the visible viewport.
      const detachedRef = useRef(false);
      // Mirrors the scrollLocked prop so the event handlers (set up once in a
      // useEffect([])) can read the current value without a stale closure.
      const scrollLockedRef = useRef(scrollLocked);
      scrollLockedRef.current = scrollLocked;

      // Instant-scroll effect for jumps (reset, seek, mode change, etc.).
      // Reads the target beat from snapBeatRef and computes the scroll position via
      // computeCursorX directly — bypassing playbackBeat — so the snap works even
      // when playbackBeat is undefined (e.g. beat 0 in listen mode, where cursorX
      // would be null). snapGeneration increments on every jump so this effect
      // always fires even when the beat is unchanged from the previous jump.
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
        if (scrollRafRef.current !== null) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = null;
        }
        scrollTargetRef.current = null;
        const x = computeCursorX(beat, score, layout);
        const leftPad =
          Number.parseFloat(getComputedStyle(el).paddingLeft) || 0;
        el.scrollLeft =
          x !== null ? Math.max(0, leftPad + x - el.clientWidth * 0.38) : 0;
        detachedRef.current = false;
      }, [snapGeneration, score, layout]);

      // Cursor position and smooth scroll-following are driven imperatively via the
      // ref handle rather than through React props, so App's 60fps setCurrentBeat
      // updates bypass the reconciler entirely for this component.
      useImperativeHandle(
        ref,
        () => ({
          setCursorBeat(beat: number | undefined) {
            const cursorX =
              beat !== undefined ? computeCursorX(beat, score, layout) : null;

            const line = cursorLineRef.current;
            if (line) {
              if (cursorX !== null) {
                line.setAttribute("x1", String(cursorX));
                line.setAttribute("x2", String(cursorX));
                line.style.visibility = "visible";
              } else {
                line.style.visibility = "hidden";
              }
            }

            const el = containerRef.current;
            if (!el || cursorX === null) {
              return;
            }

            const leftPad =
              Number.parseFloat(getComputedStyle(el).paddingLeft) || 0;
            const cursorScrollPos = leftPad + cursorX;

            if (detachedRef.current) {
              const visible =
                cursorScrollPos >= el.scrollLeft &&
                cursorScrollPos <= el.scrollLeft + el.clientWidth;
              if (!visible) {
                return;
              }
              detachedRef.current = false;
            }

            scrollTargetRef.current = Math.max(
              0,
              cursorScrollPos - el.clientWidth * 0.38,
            );

            if (scrollRafRef.current !== null) {
              return;
            }

            const step = () => {
              const target = scrollTargetRef.current;
              if (target === null || !containerRef.current) {
                scrollRafRef.current = null;
                return;
              }
              const diff = target - containerRef.current.scrollLeft;
              if (Math.abs(diff) < 0.5) {
                containerRef.current.scrollLeft = target;
                scrollTargetRef.current = null;
                scrollRafRef.current = null;
                return;
              }
              containerRef.current.scrollLeft += diff * 0.12;
              scrollRafRef.current = requestAnimationFrame(step);
            };
            scrollRafRef.current = requestAnimationFrame(step);
          },
        }),
        [score, layout],
      );

      // Focus handle drag state — ref tracks the live value between renders, state
      // drives visual feedback.
      const svgRef = useRef<SVGSVGElement>(null);
      const focusDragRef = useRef<{ handle: "left" | "right" } | null>(null);
      const dragFocusRangeRef = useRef<{ from: number; to: number } | null>(
        null,
      );
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
          const d = Math.abs(
            layout.measureXs[i] + layout.measureWidths[i] - svgX,
          );
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        return best + 1;
      };

      const onHandlePointerDown = (
        e: PointerEvent,
        handle: "left" | "right",
      ) => {
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
      const dragRef = useRef<{ startX: number; scrollLeft: number } | null>(
        null,
      );

      useEffect(() => {
        const el = containerRef.current;
        if (!el) {
          return;
        }

        const onPointerDown = (e: PointerEvent) => {
          if (scrollLockedRef.current) {
            return;
          }
          // Cancel any running auto-scroll so the manual drag always wins.
          if (scrollRafRef.current !== null) {
            cancelAnimationFrame(scrollRafRef.current);
            scrollRafRef.current = null;
          }
          scrollTargetRef.current = null;
          dragRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft };
          el.setPointerCapture(e.pointerId);
          detachedRef.current = true;
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
            return;
          }
          if (scrollRafRef.current !== null) {
            cancelAnimationFrame(scrollRafRef.current);
            scrollRafRef.current = null;
          }
          scrollTargetRef.current = null;
          detachedRef.current = true;
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
            const timeSig = score.parts[0]?.timeSig ?? {
              beats: 4,
              beatType: 4,
            };
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
            style={{
              position: "relative",
              display: "inline-block",
              flexShrink: 0,
            }}
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
                  noteColors={noteColors}
                  visible={visibleParts ? visibleParts.has(part.id) : true}
                  inkColor={inkColor}
                />
              ))}
              <line
                ref={cursorLineRef}
                x1={0}
                x2={0}
                y1={cursorY1 - 4}
                y2={cursorY2 + 4}
                stroke={cursorColor}
                stroke-width="2"
                stroke-opacity="0.85"
                style={{ visibility: "hidden" }}
              />
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
                          fill={cursorColor}
                          opacity={0.35}
                        />
                        {/* Pill thumb */}
                        <rect
                          x={x - 6}
                          y={midY - 18}
                          width={12}
                          height={36}
                          rx={6}
                          fill={cursorColor}
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
          </div>
        </div>
      );
    },
  ),
);

// ── Staff ─────────────────────────────────────────────────────────────────────

interface StaffProps {
  part: ParsedPart;
  partIndex: number;
  layout: ResolvedLayout;
  staffBottomY: number;
  noteColors: Record<string, string>;
  visible: boolean;
  inkColor: string;
}

const Staff = memo(function Staff({
  part,
  partIndex,
  layout,
  staffBottomY,
  noteColors,
  visible,
  inkColor,
}: StaffProps) {
  const { staffSpace, totalWidth, measureXs, measureWidths } = layout;
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
          keySig={part.keySig}
          isFirstMeasure={m === 0}
          x={measureXs[m]}
          staffBottomY={staffBottomY}
          layout={layout}
          noteColors={noteColors}
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
  keySig: { fifths: number; mode: string };
  isFirstMeasure: boolean;
  x: number;
  staffBottomY: number;
  layout: ResolvedLayout;
  noteColors: Record<string, string>;
  inkColor: string;
}

const Measure = memo(function Measure({
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
  inkColor,
}: MeasureProps) {
  const { staffSpace, noteUnitWidth } = layout;
  const eventXs = eventXPositions(
    measure.events,
    x,
    isFirstMeasure,
    keySig.fifths,
    noteUnitWidth,
    staffSpace,
  );

  const hdrWidth = isFirstMeasure ? headerWidth(keySig.fifths) : 0;
  const clefX = x + 2;
  const keySigX = clefX + 32;
  const timeSigX = keySigX + Math.abs(keySig.fifths) * 10;

  const beamGroups = computeBeamGroups(
    measure.events,
    eventXs,
    clef,
    staffBottomY,
    staffSpace,
  );

  // Map from event index → beam stem override (direction + tip Y)
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
            keySig={keySig}
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
              noteColors={noteColors}
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
});

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
  noteColors: Record<string, string>;
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

function ChordGroupEl({
  group,
  x,
  staffBottomY,
  clef,
  partIndex,
  measureNumber,
  noteColors,
  staffSpace,
  inkColor,
  beamStemOverride,
}: ChordGroupElProps) {
  const { type, notes, noteIndex, dot } = group;
  const hasNoStem = type === "whole";

  const noteYs = notes.map((n) =>
    noteY(n.pitch, clef, staffBottomY, staffSpace),
  );
  const topY = Math.min(...noteYs);
  const bottomY = Math.max(...noteYs);
  const stemDir = beamStemOverride?.stemDir ?? stemDirection(group, clef);
  const stemLength = staffSpace * 3;
  const nrx = staffSpace * 0.55;
  const xOffsets = chordXOffsets(notes, stemDir, nrx);

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
    <g data-chord-id={`p${partIndex}-m${measureNumber}-n${noteIndex}`}>
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
      {notes.map((note, v) => {
        const ny = noteYs[v];
        const nx = x + xOffsets[v];
        const id = `p${partIndex}-m${measureNumber}-n${noteIndex}-v${v}`;
        const color = noteColors[id] ?? inkColor;
        return (
          <g key={id}>
            <Notehead
              x={nx}
              y={ny}
              type={type}
              id={id}
              color={color}
              showAccidental={note.showAccidental}
              staffSpace={staffSpace}
            />
            {ledgerLineYs(note.pitch, clef, staffBottomY, staffSpace).map(
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
            {dot && (
              <circle
                cx={nx + nrx + 4}
                cy={ny - staffSpace / 4}
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

function Notehead({
  x,
  y,
  type,
  id,
  color,
  showAccidental,
  staffSpace,
}: {
  x: number;
  y: number;
  type: NoteType;
  id: string;
  color: string;
  showAccidental: boolean;
  staffSpace: number;
}) {
  const char =
    type === "whole"
      ? G.noteheadWhole
      : type === "half"
        ? G.noteheadHalf
        : G.noteheadBlack;

  return (
    <g>
      {showAccidental && (
        <text x={x - staffSpace * 1.4} y={y} fill={color} text-anchor="middle">
          {G.accSharp}
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
