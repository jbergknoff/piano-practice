import type { ComponentChildren } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { ClickTrack } from "../../lib/midi/click-track";
import {
  type PlaybackNote,
  playbackNoteId,
} from "../../lib/musicxml/musicxml-playback";
import {
  formatDate,
  ResultModal,
  type ResultRow,
  ScoreChip,
} from "../components/ResultModal";
import {
  type PlayalongAttempt,
  clearPlayalongAttempts,
  deletePlayalongAttempt,
  loadPlayalongAttemptHistory,
  savePlayalongAttempt,
} from "../hooks/use-file-history";
import {
  selectionEndBeat,
  selectionKeyForRange,
  selectionLabelForRange,
  selectionStartBeat,
} from "../selection";
import type { ThemeTokens } from "../theme";
import { blurFilter } from "../theme";
import type { ModeControl, ModeHandle, NoteHighlight } from "./mode-control";
import { soundingHighlights, useStableHighlights } from "./note-colors";

export type PlayalongPhase =
  | "idle"
  | "counting-in"
  | "waiting-for-note"
  | "playing"
  | "complete";

export interface PlayalongSettings {
  timingBeats: number;
  /** When true, the song is played aloud via Web Audio (phone speaker). */
  playMusic: boolean;
  /** When true, hi-hat metronome ticks are sent to the piano throughout playback. */
  metronome: boolean;
  /**
   * When true, a metronome count-in precedes playback. When false, playback
   * begins as soon as the user presses the first note.
   */
  countIn: boolean;
  /** Current BPM — recorded with each attempt for the history table. */
  bpm: number;
  accent: string;
  theme: ThemeTokens;
}

export interface PlayalongModeHandle extends ModeHandle {
  /** Exposed so PracticeScreen can label the play button "Stop" during count-in. */
  phase: PlayalongPhase;
}

/**
 * 1-based measure number containing `beat`, from the actual per-measure start
 * beats (correct for pickup measures, unlike `floor(beat / timeSigNum) + 1`).
 * Returns -1 when the beat is negative or no measure data is available.
 */
function measureNumberForBeat(
  measureStartBeats: number[],
  beat: number,
): number {
  if (beat < 0 || measureStartBeats.length === 0) {
    return -1;
  }
  let measure = 1;
  for (let index = 1; index < measureStartBeats.length; index++) {
    if (measureStartBeats[index] <= beat) {
      measure = index + 1;
    } else {
      break;
    }
  }
  return measure;
}

export function usePlayalongMode(
  control: ModeControl,
  settings: PlayalongSettings,
): PlayalongModeHandle {
  const [phase, setPhase] = useState<PlayalongPhase>("idle");
  const [hitNoteIds, setHitNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [playerMarkers, setPlayerMarkers] = useState<
    ReadonlyArray<NoteHighlight>
  >([]);
  // 1-based beat of the bar the count-in is on, for the overlay.
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [resultModal, setResultModal] = useState<{
    history: PlayalongAttempt[];
    selectionLabel: string;
    hash: string;
    selectionKey: string;
  } | null>(null);

  const activeRef = useRef(false);
  const phaseRef = useRef<PlayalongPhase>("idle");
  const hitNoteIdsRef = useRef<Set<string>>(new Set());
  const extraNoteCountRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const playerMarkersRef = useRef<NoteHighlight[]>([]);
  const uninstallCallbacksRef = useRef<(() => void) | null>(null);
  const uninstallAudioRoutingRef = useRef<(() => void) | null>(null);
  // Takes this session's metronome (count-in and clicks) off the shared
  // player. The player outlives the session (other modes use it too), so a
  // metronome left on it would keep clicking after Stop, or in Listen mode.
  const removeMetronomeRef = useRef<(() => void) | null>(null);

  const controlRef = useRef(control);
  controlRef.current = control;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Reset when the measure range changes while in the "complete" phase.
  // Without this, switching ranges after a completed playthrough applies the old
  // hit set to the new range's notes, coloring all of them red.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measureRange is the trigger; stopPlayalong reads only from refs
  useEffect(() => {
    if (phaseRef.current === "complete") {
      stopPlayalong();
    }
  }, [control.measureRange]);

  // Reset when musicxml changes (new file loaded).
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger; resetPlayalongState reads only from refs
  useEffect(() => {
    resetPlayalongState();
  }, [control.musicxml]);

  // Notes in the current selection (not tie-continuations).
  const selectionNotes = useMemo<PlaybackNote[]>(() => {
    const musicxml = control.musicxml;
    if (!musicxml) {
      return [];
    }
    const range = control.measureRange;
    const measureStartBeats = control.measureStartBeats;
    const startBeat = selectionStartBeat(range, measureStartBeats);
    const endBeat = selectionEndBeat(
      range,
      measureStartBeats,
      musicxml.totalBeats,
    );
    return musicxml.notes.filter((n) => {
      if (n.tieStop) {
        return false;
      }
      // Use graceMainBeat ?? startBeat for range membership: grace notes have an
      // graceMainBeat equal to the main note's accumulated beatCursor, which lands
      // exactly on the barline. Their startBeat is derived by subtraction and
      // may fall just before the boundary, pulling them into the wrong measure.
      return (
        (n.graceMainBeat ?? n.startBeat) >= startBeat &&
        (n.graceMainBeat ?? n.startBeat) < endBeat
      );
    });
  }, [control.musicxml, control.measureRange, control.measureStartBeats]);

  const selectionNotesRef = useRef(selectionNotes);
  selectionNotesRef.current = selectionNotes;

  // F1-style score: harmonic mean of precision and recall.
  function computeScore(): number {
    const notes = selectionNotesRef.current;
    if (notes.length === 0) {
      return 100;
    }
    const matched = notes.filter((n) =>
      hitNoteIdsRef.current.has(playbackNoteId(n)),
    ).length;
    const extra = extraNoteCountRef.current;
    const expected = notes.length;
    if (matched === 0) {
      return 0;
    }
    return Math.round(((2 * matched) / (expected + matched + extra)) * 100);
  }

  function recordCompletion(score: number) {
    const modeControl = controlRef.current;
    const hash = modeControl.fileHash;
    if (!hash) {
      return;
    }
    const range = modeControl.measureRange;
    const selectionKey = selectionKeyForRange(range);
    const attempt: PlayalongAttempt = {
      timestamp: Date.now(),
      score,
      bpm: settingsRef.current.bpm,
    };
    savePlayalongAttempt(hash, selectionKey, attempt);
    const allAttempts = loadPlayalongAttemptHistory(hash)[selectionKey] ?? [];
    const selectionLabel = selectionLabelForRange(range);
    setResultModal({
      history: allAttempts,
      selectionLabel,
      hash,
      selectionKey,
    });
  }

  // Resets all playalong state to "idle" without touching the player or cursor.
  // Called by every path that needs to initialize or clear the session:
  // stopPlayalong (user stop/reset/mode-switch), the musicxml effect (new file),
  // and indirectly the measureRange effect (range change while complete).
  function resetPlayalongState() {
    uninstallAudioRoutingRef.current?.();
    uninstallAudioRoutingRef.current = null;
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = null;
    removeMetronomeRef.current?.();
    removeMetronomeRef.current = null;
    phaseRef.current = "idle";
    setPhase("idle");
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;
    heldNotesRef.current = new Set();
    playerMarkersRef.current = [];
    setPlayerMarkers([]);
    setCountInBeat(null);
    setResultModal(null);
  }

  function stopPlayalong() {
    resetPlayalongState();
    const modeControl = controlRef.current;
    modeControl.player.pause();
    modeControl.setIsPlaying(false);
    const range = modeControl.measureRange;
    const startBeat = selectionStartBeat(range, modeControl.measureStartBeats);
    modeControl.player.seek(startBeat);
    modeControl.setCursor(startBeat, "jump");
  }

  // Start the clock from the play position. With `countInBeats`, it starts
  // that many beats early and the session stays "counting-in" until the clock
  // reaches the play position; otherwise it is "playing" straight away.
  async function startPlaying(countInBeats = 0) {
    const modeControl = controlRef.current;
    const player = modeControl.player;
    const scoreConversion = modeControl.musicxml;
    if (!scoreConversion) {
      return;
    }

    const phase: PlayalongPhase = countInBeats > 0 ? "counting-in" : "playing";
    phaseRef.current = phase;
    setPhase(phase);

    // Install onEnd so we can finalize score + uninstall audio routing.
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = player.installCallbacks({
      onEnd: (beat) => {
        modeControl.setIsPlaying(false);
        modeControl.setCursor(beat, "jump");
        if (phaseRef.current !== "playing") {
          return;
        }
        uninstallAudioRoutingRef.current?.();
        uninstallAudioRoutingRef.current = null;
        removeMetronomeRef.current?.();
        removeMetronomeRef.current = null;
        phaseRef.current = "complete";
        setPhase("complete");
        recordCompletion(computeScore());
      },
    });

    // Web Audio output is the default; when "play music aloud" is off, mute it.
    if (!settingsRef.current.playMusic) {
      uninstallAudioRoutingRef.current?.();
      uninstallAudioRoutingRef.current = player.setAudioRouting({
        skipWebAudio: true,
      });
    }

    // One click track covers both the count-in (the clicks before the play
    // position) and the metronome (the clicks after it), on the same clock as
    // the music, so the first note lands exactly one beat after the last
    // count-in click.
    const startBeat = player.currentBeat();
    const metronome = settingsRef.current.metronome;
    if (countInBeats > 0 || metronome) {
      removeMetronomeRef.current = player.addPlaybackTrack(
        new ClickTrack({
          firstBeat: startBeat - countInBeats,
          endBeat: metronome ? Number.POSITIVE_INFINITY : startBeat,
          beatsPerBar: scoreConversion.timeSigNum,
          onClick: (click) => {
            modeControl.piano.playHiHat(click.beatInBar === 0 ? 80 : 55);
            if (click.beat < startBeat) {
              setCountInBeat(click.beatInBar + 1);
            }
          },
        }),
      );
    }

    await player.play({
      leadInBeats: countInBeats,
      onLeadInEnd: () => {
        setCountInBeat(null);
        if (phaseRef.current === "counting-in") {
          phaseRef.current = "playing";
          setPhase("playing");
        }
      },
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayalong / computeScore / recordCompletion / startPlaying read only from refs; stable by design
  const handlePlayPause = useCallback(async () => {
    const modeControl = controlRef.current;
    const player = modeControl.player;

    if (
      phaseRef.current === "counting-in" ||
      phaseRef.current === "waiting-for-note" ||
      phaseRef.current === "playing"
    ) {
      stopPlayalong();
      return;
    }

    const scoreConversion = modeControl.musicxml;
    if (!scoreConversion) {
      return;
    }

    const range = modeControl.measureRange;
    const startBeat = selectionStartBeat(range, modeControl.measureStartBeats);
    player.seek(startBeat);
    modeControl.setCursor(startBeat, "jump");

    // Reset score state.
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;
    playerMarkersRef.current = [];
    setPlayerMarkers([]);
    modeControl.setIsPlaying(true);

    if (!settingsRef.current.countIn) {
      // Skip count-in: wait for the user's first note to begin playback.
      phaseRef.current = "waiting-for-note";
      setPhase("waiting-for-note");
      return;
    }

    // Two bars of count-in.
    await startPlaying(2 * scoreConversion.timeSigNum);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayalong reads only from refs; stable by design
  const handleReset = useCallback(() => {
    stopPlayalong();
  }, []);

  const handleSeek = useCallback((beat: number) => {
    const modeControl = controlRef.current;
    modeControl.player.seek(beat);
    modeControl.setCursor(beat, "jump");
  }, []);

  const activate = useCallback(() => {
    activeRef.current = true;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayalong reads only from refs; stable by design
  const deactivate = useCallback(() => {
    stopPlayalong();
    activeRef.current = false;
  }, []);

  // Stable: reads only from refs so it never goes stale inside the BLE listener.
  // biome-ignore lint/correctness/useExhaustiveDependencies: startPlaying reads only from refs; stable by design
  const onNoteEvent = useCallback((noteNumber: number, kind: "on" | "off") => {
    const modeControl = controlRef.current;
    const now = Date.now();
    // Read the audio clock directly: currentBeatRef only advances on the
    // player's throttled position updates (every 50 ms), so it can lag the
    // true playback position by a tenth of a beat at 120 BPM.
    const beat = modeControl.player.currentBeat();
    const measure = measureNumberForBeat(modeControl.measureStartBeats, beat);
    const held = heldNotesRef.current;

    if (kind === "off") {
      held.delete(noteNumber);
      modeControl.appendToDebugLog({
        mode: "playalong",
        t: now,
        note: noteNumber,
        kind: "off",
        measure,
        beat,
        held: [...held],
        outcome: "off",
      });
      return;
    }

    held.add(noteNumber);

    // First note while waiting (count-in disabled) kicks off playback. Fall
    // through so this same press is also evaluated against the first notes.
    if (phaseRef.current === "waiting-for-note") {
      void startPlaying();
    }

    if (phaseRef.current !== "playing") {
      modeControl.appendToDebugLog({
        mode: "playalong",
        t: now,
        note: noteNumber,
        kind: "on",
        measure,
        beat,
        held: [...held],
        outcome: "inactive",
      });
      return;
    }

    const notes = selectionNotesRef.current;
    const toleranceBeats = settingsRef.current.timingBeats;

    let matched = false;
    const newHits = new Set(hitNoteIdsRef.current);

    for (const note of notes) {
      if (
        note.noteNumber === noteNumber &&
        Math.abs(note.startBeat - beat) <= toleranceBeats
      ) {
        const id = playbackNoteId(note);
        if (!newHits.has(id)) {
          newHits.add(id);
          matched = true;
        }
      }
    }

    if (matched) {
      hitNoteIdsRef.current = newHits;
      setHitNoteIds(newHits);
    } else {
      extraNoteCountRef.current += 1;
    }

    const nextMarkers: NoteHighlight[] = [
      ...playerMarkersRef.current,
      {
        kind: "marker",
        noteNumber,
        beat,
        color: matched ? "#43a047" : "#e53935",
      },
    ];
    playerMarkersRef.current = nextMarkers;
    setPlayerMarkers(nextMarkers);

    modeControl.appendToDebugLog({
      mode: "playalong",
      t: now,
      note: noteNumber,
      kind: "on",
      measure,
      beat,
      held: [...held],
      outcome: matched ? "matched" : "extra",
    });
  }, []);

  // Score-note highlights: green for hits, red for missed past notes (after
  // tolerance); during idle phase, fall back to "highlight currently sounding
  // notes". The player-marker entries are appended below (they live alongside
  // these in the same noteHighlights stream).
  const computedHighlights = useMemo<ReadonlyArray<NoteHighlight>>(() => {
    const musicxml = control.musicxml;
    if (!musicxml) {
      return playerMarkers;
    }

    const scoreHighlights: NoteHighlight[] = [];

    if (phase === "playing" || phase === "complete") {
      // In complete phase, treat all selection notes as past. Iterating
      // `selectionNotes` (rather than re-filtering `musicxml.notes` by range)
      // guarantees the notes scored and the notes colored are exactly the
      // same set.
      const effectiveBeat =
        phase === "complete" ? Number.POSITIVE_INFINITY : control.currentBeat;
      for (const note of selectionNotes) {
        const id = playbackNoteId(note);
        if (hitNoteIds.has(id)) {
          scoreHighlights.push({ kind: "score", id, color: "#43a047" });
        } else if (note.startBeat < effectiveBeat - settings.timingBeats) {
          scoreHighlights.push({ kind: "score", id, color: "#e53935" });
        }
      }
    } else if (control.currentBeat > 0) {
      // Idle / counting-in: behave like listen mode — highlight sounding notes.
      // Skip when the cursor is at the very start so the first note doesn't
      // pre-highlight before playback begins. Shares listen mode's
      // `soundingHighlights` so the focus-range measure filter (which stops a
      // prior-measure note ending on the barline from leaking in) is applied
      // here too, not just in listen mode.
      scoreHighlights.push(
        ...soundingHighlights(
          musicxml.notes,
          control.currentBeat,
          control.measureRange,
          settings.accent,
        ),
      );
    }

    return scoreHighlights.concat(playerMarkers);
  }, [
    control.musicxml,
    control.currentBeat,
    control.measureRange,
    phase,
    hitNoteIds,
    playerMarkers,
    selectionNotes,
    settings.timingBeats,
    settings.accent,
  ]);
  const noteHighlights = useStableHighlights(computedHighlights);

  const overlay =
    phase === "counting-in" ? (
      <CountInOverlay countInBeat={countInBeat} />
    ) : phase === "waiting-for-note" ? (
      <WaitingForNoteOverlay />
    ) : null;

  const modal = resultModal
    ? (() => {
        const history = resultModal.history;
        const latest = history[history.length - 1];
        const currentBpm = latest?.bpm;
        const rows: ResultRow[] = history
          .filter((a) => a.bpm === currentBpm)
          .slice()
          .reverse()
          .slice(0, 10)
          .map((a) => ({
            key: a.timestamp,
            isLatest: a.timestamp === latest?.timestamp,
            when: formatDate(a.timestamp),
            cells: [<ScoreChip key="score" score={a.score} />],
          }));
        return (
          <ResultModal
            theme={settings.theme}
            accent={settings.accent}
            selectionLabel={resultModal.selectionLabel}
            latest={
              latest
                ? { score: latest.score, headerRight: `${latest.bpm} BPM` }
                : null
            }
            history={{
              label: currentBpm ? `Attempts at ${currentBpm} BPM` : "Attempts",
              gridTemplate: "1fr 64px",
              columns: ["When", "Score"],
              rows,
            }}
            onClose={() => {
              setResultModal(null);
              // Keep phase="complete" so green/red note colors remain for review.
              // Seek to start so the sheet is positioned at the beginning.
              const modeControl = controlRef.current;
              const range = modeControl.measureRange;
              const startBeat = selectionStartBeat(
                range,
                modeControl.measureStartBeats,
              );
              modeControl.player.seek(startBeat);
              modeControl.setCursor(startBeat, "jump");
            }}
            previousRange={control.rangeNavigation.previous}
            nextRange={control.rangeNavigation.next}
            onNavigateToRange={(range) => {
              setResultModal(null);
              control.rangeNavigation.goTo(range);
            }}
            onDeleteRow={(key) => {
              const updatedHistory = deletePlayalongAttempt(
                resultModal.hash,
                resultModal.selectionKey,
                key as number,
              );
              const remainingAtCurrentBpm = updatedHistory.filter(
                (a) => a.bpm === currentBpm,
              );
              if (remainingAtCurrentBpm.length === 0) {
                setResultModal(null);
              } else {
                setResultModal({ ...resultModal, history: updatedHistory });
              }
            }}
            onClearRows={
              currentBpm !== undefined
                ? () => {
                    clearPlayalongAttempts(
                      resultModal.hash,
                      resultModal.selectionKey,
                      currentBpm,
                    );
                    setResultModal(null);
                  }
                : undefined
            }
          />
        );
      })()
    : null;

  return {
    noteHighlights,
    activeRef,
    onNoteEvent,
    activate,
    deactivate,
    handlePlayPause,
    handleReset,
    handleSeek,
    overlay,
    modal,
    phase,
  };
}

// Shared centered frosted-glass card used by both transport overlays below —
// they differ only in the main content and the caption underneath it.
function TransportOverlayCard({
  padding,
  caption,
  children,
}: {
  padding: string;
  caption: string;
  children: ComponentChildren;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 10,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.55)",
          ...blurFilter("blur(8px)"),
          borderRadius: 16,
          padding,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {children}
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.7)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginTop: 8,
          }}
        >
          {caption}
        </div>
      </div>
    </div>
  );
}

function CountInOverlay({ countInBeat }: { countInBeat: number | null }) {
  return (
    <TransportOverlayCard padding="14px 28px" caption="Count in…">
      <div
        style={{
          fontSize: 72,
          fontWeight: 700,
          color: "#fff",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {countInBeat ?? ""}
      </div>
    </TransportOverlayCard>
  );
}

function WaitingForNoteOverlay() {
  return (
    <TransportOverlayCard padding="18px 28px" caption="to start">
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#fff",
          lineHeight: 1.1,
          textAlign: "center",
        }}
      >
        Press any key
      </div>
    </TransportOverlayCard>
  );
}
