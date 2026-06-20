import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { PlaybackNote } from "../../lib/musicxml/musicxml-playback";
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
import type { ThemeTokens } from "../theme";
import { blurFilter } from "../theme";
import type { ModeControl, ModeHandle, NoteHighlight } from "./mode-control";
import { useStableHighlights } from "./note-colors";

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
  /** When true, hi-hat metronome ticks are sent to the piano via BLE MIDI. */
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

function noteKey(note: PlaybackNote): string {
  return `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
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
  const [countInBeat, setCountInBeat] = useState<{
    beat: number;
    timeSigNum: number;
  } | null>(null);
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
  const countInCancelRef = useRef<(() => void) | null>(null);
  const uninstallCallbacksRef = useRef<(() => void) | null>(null);
  const uninstallAudioRoutingRef = useRef<(() => void) | null>(null);
  const metronomeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopMetronome() {
    if (metronomeTimerRef.current !== null) {
      clearInterval(metronomeTimerRef.current);
      metronomeTimerRef.current = null;
    }
  }

  function startMetronome() {
    stopMetronome();
    const ctrl = controlRef.current;
    const mx = ctrl.musicxml;
    if (!mx) {
      return;
    }
    const msPerBeat = (60 / settingsRef.current.bpm) * 1000;
    const timeSigNum = mx.timeSigNum;
    let beatIdx = 0;
    const tick = () => {
      const isDownbeat = beatIdx % timeSigNum === 0;
      ctrl.bluetooth.sendNote(42, isDownbeat ? 80 : 55, 80, 9);
      beatIdx++;
    };
    tick();
    metronomeTimerRef.current = setInterval(tick, msPerBeat);
  }

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
    const startBeat = range ? (measureStartBeats[range.from - 1] ?? 0) : 0;
    const endBeat = range
      ? (measureStartBeats[range.to] ?? musicxml.totalBeats)
      : musicxml.totalBeats;
    return musicxml.notes.filter((n) => {
      if (n.tieStop) {
        return false;
      }
      // Grace notes use graceMainBeat for range membership: their startBeat is
      // derived by subtraction and may land just before a barline that is the
      // range boundary, incorrectly pulling them into the adjacent measure's
      // selection. graceMainBeat is the accumulated beat of the note they
      // ornament and is immune to that floating-point drift.
      const rangeBeat =
        n.isGrace && n.graceMainBeat !== undefined
          ? n.graceMainBeat
          : n.startBeat;
      return rangeBeat >= startBeat && rangeBeat < endBeat;
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
      hitNoteIdsRef.current.has(noteKey(n)),
    ).length;
    const extra = extraNoteCountRef.current;
    const expected = notes.length;
    if (matched === 0) {
      return 0;
    }
    return Math.round(((2 * matched) / (expected + matched + extra)) * 100);
  }

  function recordCompletion(score: number) {
    const ctrl = controlRef.current;
    const hash = ctrl.fileHash;
    if (!hash) {
      return;
    }
    const range = ctrl.measureRange;
    const selectionKey = range ? `m${range.from}-m${range.to}` : "full";
    const attempt: PlayalongAttempt = {
      timestamp: Date.now(),
      score,
      bpm: settingsRef.current.bpm,
    };
    savePlayalongAttempt(hash, selectionKey, attempt);
    const allAttempts = loadPlayalongAttemptHistory(hash)[selectionKey] ?? [];
    const selectionLabel = range
      ? range.from === range.to
        ? `Measure ${range.from}`
        : `Measures ${range.from}–${range.to}`
      : "Full piece";
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
    countInCancelRef.current?.();
    countInCancelRef.current = null;
    uninstallAudioRoutingRef.current?.();
    uninstallAudioRoutingRef.current = null;
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = null;
    stopMetronome();
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
    const ctrl = controlRef.current;
    ctrl.player.pause();
    ctrl.setIsPlaying(false);
    const range = ctrl.measureRange;
    const startBeat = range ? (ctrl.measureStartBeats[range.from - 1] ?? 0) : 0;
    ctrl.player.seek(startBeat);
    ctrl.setCursor(startBeat, "jump");
  }

  async function startPlaying() {
    const ctrl = controlRef.current;
    const player = ctrl.player;

    phaseRef.current = "playing";
    setPhase("playing");

    // Install onEnd so we can finalize score + uninstall audio routing.
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = player.installCallbacks({
      onEnd: (beat) => {
        ctrl.setIsPlaying(false);
        ctrl.setCursor(beat, "jump");
        if (phaseRef.current !== "playing") {
          return;
        }
        uninstallAudioRoutingRef.current?.();
        uninstallAudioRoutingRef.current = null;
        stopMetronome();
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

    if (settingsRef.current.metronome) {
      startMetronome();
    }

    await player.play();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayalong / computeScore / recordCompletion / startPlaying read only from refs; stable by design
  const handlePlayPause = useCallback(async () => {
    const ctrl = controlRef.current;
    const player = ctrl.player;

    if (
      phaseRef.current === "counting-in" ||
      phaseRef.current === "waiting-for-note" ||
      phaseRef.current === "playing"
    ) {
      stopPlayalong();
      return;
    }

    const mx = ctrl.musicxml;
    if (!mx) {
      return;
    }

    const range = ctrl.measureRange;
    const startBeat = range ? (ctrl.measureStartBeats[range.from - 1] ?? 0) : 0;
    player.seek(startBeat);
    ctrl.setCursor(startBeat, "jump");

    // Reset score state.
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;
    playerMarkersRef.current = [];
    setPlayerMarkers([]);
    ctrl.setIsPlaying(true);

    if (!settingsRef.current.countIn) {
      // Skip count-in: wait for the user's first note to begin playback.
      phaseRef.current = "waiting-for-note";
      setPhase("waiting-for-note");
      return;
    }

    phaseRef.current = "counting-in";
    setPhase("counting-in");

    const countInBeats = 2 * mx.timeSigNum;
    const { cancel, done } = player.playCountIn(
      countInBeats,
      mx.timeSigNum,
      (i) => {
        const isDownbeat = i % mx.timeSigNum === 0;
        ctrl.bluetooth.sendNote(42, isDownbeat ? 80 : 55, 80, 9);
        setCountInBeat({ beat: i, timeSigNum: mx.timeSigNum });
      },
    );
    countInCancelRef.current = cancel;

    await done;
    setCountInBeat(null);

    if ((phaseRef.current as PlayalongPhase) !== "counting-in") {
      // Stopped during count-in — stopPlayalong already cleaned up.
      ctrl.setIsPlaying(false);
      return;
    }
    countInCancelRef.current = null;

    await startPlaying();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayalong reads only from refs; stable by design
  const handleReset = useCallback(() => {
    stopPlayalong();
  }, []);

  const handleSeek = useCallback((beat: number) => {
    const ctrl = controlRef.current;
    ctrl.player.seek(beat);
    ctrl.setCursor(beat, "jump");
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
    const ctrl = controlRef.current;
    const now = Date.now();
    const beat = ctrl.currentBeatRef.current;
    const timeSigNum = ctrl.musicxml?.timeSigNum ?? 4;
    const measure = beat >= 0 ? Math.floor(beat / timeSigNum) + 1 : -1;
    const held = heldNotesRef.current;

    if (kind === "off") {
      held.delete(noteNumber);
      ctrl.appendToDebugLog({
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
      ctrl.appendToDebugLog({
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
    const tol = settingsRef.current.timingBeats;

    let matched = false;
    const newHits = new Set(hitNoteIdsRef.current);

    for (const note of notes) {
      if (
        note.noteNumber === noteNumber &&
        Math.abs(note.startBeat - beat) <= tol
      ) {
        const id = noteKey(note);
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

    ctrl.appendToDebugLog({
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
      const range = control.measureRange;
      const measureStartBeats = control.measureStartBeats;
      const startBeat = range ? (measureStartBeats[range.from - 1] ?? 0) : 0;
      const endBeat = range
        ? (measureStartBeats[range.to] ?? musicxml.totalBeats)
        : musicxml.totalBeats;
      // In complete phase, treat all selection notes as past.
      const effectiveBeat =
        phase === "complete" ? Number.POSITIVE_INFINITY : control.currentBeat;
      for (const note of musicxml.notes) {
        if (note.tieStop) {
          continue;
        }
        const rangeBeat =
          note.isGrace && note.graceMainBeat !== undefined
            ? note.graceMainBeat
            : note.startBeat;
        if (rangeBeat < startBeat || rangeBeat >= endBeat) {
          continue;
        }
        const id = noteKey(note);
        if (hitNoteIds.has(id)) {
          scoreHighlights.push({ kind: "score", id, color: "#43a047" });
        } else if (note.startBeat < effectiveBeat - settings.timingBeats) {
          scoreHighlights.push({ kind: "score", id, color: "#e53935" });
        }
      }
    } else if (control.currentBeat > 0) {
      // Idle / counting-in: behave like listen mode — highlight sounding notes.
      // Skip when the cursor is at the very start so the first note doesn't
      // pre-highlight before playback begins.
      for (const note of musicxml.notes) {
        if (
          note.startBeat <= control.currentBeat &&
          control.currentBeat < note.startBeat + note.durationBeats
        ) {
          scoreHighlights.push({
            kind: "score",
            id: noteKey(note),
            color: settings.accent,
          });
        }
      }
    }

    return scoreHighlights.concat(playerMarkers);
  }, [
    control.musicxml,
    control.measureRange,
    control.measureStartBeats,
    control.currentBeat,
    phase,
    hitNoteIds,
    playerMarkers,
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
              const ctrl = controlRef.current;
              const mx = ctrl.musicxml;
              const range = ctrl.measureRange;
              const startBeat = range
                ? (ctrl.measureStartBeats[range.from - 1] ?? 0)
                : 0;
              ctrl.player.seek(startBeat);
              ctrl.setCursor(startBeat, "jump");
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

function CountInOverlay({
  countInBeat,
}: {
  countInBeat: { beat: number; timeSigNum: number } | null;
}) {
  const beatDisplay = countInBeat
    ? (countInBeat.beat % countInBeat.timeSigNum) + 1
    : null;
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
          padding: "14px 28px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {beatDisplay ?? ""}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.7)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginTop: 8,
          }}
        >
          Count in…
        </div>
      </div>
    </div>
  );
}

function WaitingForNoteOverlay() {
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
          padding: "18px 28px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
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
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.7)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginTop: 8,
          }}
        >
          to start
        </div>
      </div>
    </div>
  );
}
