import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { PlayalongResultModal } from "./components/PlayalongResultModal";
import type { PlaybackNote } from "./midi-to-musicxml";
import type { ModeControl, ModeHandle } from "./mode-control";
import { useStableNoteColors } from "./note-colors";
import type { ThemeTokens } from "./theme";
import {
  type PlayalongAttempt,
  loadPlayalongAttemptHistory,
  savePlayalongAttempt,
} from "./use-file-history";

export type PlayalongPhase = "idle" | "counting-in" | "playing" | "complete";

export interface PlayalongSettings {
  timingBeats: number;
  pianoAudio: boolean;
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
  const [countInBeat, setCountInBeat] = useState<{
    beat: number;
    timeSigNum: number;
  } | null>(null);
  const [resultModal, setResultModal] = useState<{
    history: PlayalongAttempt[];
    selectionLabel: string;
  } | null>(null);

  const activeRef = useRef(false);
  const phaseRef = useRef<PlayalongPhase>("idle");
  const hitNoteIdsRef = useRef<Set<string>>(new Set());
  const extraNoteCountRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const countInCancelRef = useRef<(() => void) | null>(null);
  const uninstallCallbacksRef = useRef<(() => void) | null>(null);
  const uninstallAudioRoutingRef = useRef<(() => void) | null>(null);

  const controlRef = useRef(control);
  controlRef.current = control;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Reset when musicxml changes (new file loaded).
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger
  useEffect(() => {
    countInCancelRef.current?.();
    countInCancelRef.current = null;
    uninstallAudioRoutingRef.current?.();
    uninstallAudioRoutingRef.current = null;
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = null;
    phaseRef.current = "idle";
    setPhase("idle");
    hitNoteIdsRef.current = new Set();
    setHitNoteIds(new Set());
    extraNoteCountRef.current = 0;
    heldNotesRef.current = new Set();
    setCountInBeat(null);
    setResultModal(null);
  }, [control.musicxml]);

  // Notes in the current selection (not tie-continuations).
  const selectionNotes = useMemo<PlaybackNote[]>(() => {
    const musicxml = control.musicxml;
    if (!musicxml) {
      return [];
    }
    const range = control.measureRange;
    const startBeat = range ? (range.from - 1) * musicxml.timeSigNum : 0;
    const endBeat = range
      ? range.to * musicxml.timeSigNum
      : musicxml.totalBeats;
    return musicxml.notes.filter(
      (n) => !n.tieStop && n.startBeat >= startBeat && n.startBeat < endBeat,
    );
  }, [control.musicxml, control.measureRange]);

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
    setResultModal({ history: allAttempts, selectionLabel });
  }

  function stopPlayalong() {
    countInCancelRef.current?.();
    countInCancelRef.current = null;
    uninstallAudioRoutingRef.current?.();
    uninstallAudioRoutingRef.current = null;
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = null;
    const ctrl = controlRef.current;
    ctrl.player.pause();
    ctrl.setIsPlaying(false);
    setCountInBeat(null);

    phaseRef.current = "idle";
    setPhase("idle");
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;

    const mx = ctrl.musicxml;
    const range = ctrl.measureRange;
    const startBeat = range && mx ? (range.from - 1) * mx.timeSigNum : 0;
    ctrl.player.seek(startBeat);
    ctrl.setCursor(startBeat, "jump");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayalong / computeScore / recordCompletion read only from refs; stable by design
  const handlePlayPause = useCallback(async () => {
    const ctrl = controlRef.current;
    const player = ctrl.player;

    if (phaseRef.current === "counting-in" || phaseRef.current === "playing") {
      stopPlayalong();
      return;
    }

    const mx = ctrl.musicxml;
    if (!mx) {
      return;
    }

    const range = ctrl.measureRange;
    const startBeat = range ? (range.from - 1) * mx.timeSigNum : 0;
    player.seek(startBeat);
    ctrl.setCursor(startBeat, "jump");

    // Reset score state and enter counting-in.
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;
    phaseRef.current = "counting-in";
    setPhase("counting-in");
    ctrl.setIsPlaying(true);

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
        phaseRef.current = "complete";
        setPhase("complete");
        recordCompletion(computeScore());
      },
    });

    if (settingsRef.current.pianoAudio) {
      uninstallAudioRoutingRef.current?.();
      uninstallAudioRoutingRef.current = player.setAudioRouting({
        skipWebAudio: true,
        onNoteScheduled: (notes) => {
          ctrl.bluetooth.sendNotesBatch(
            notes.map((n) => ({
              note: n.noteNumber,
              velocity: Math.max(1, Math.round(n.velocity * 0.3)),
              durationMs: n.durationMs,
            })),
          );
        },
      });
    }

    await player.play();
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

  // Note colors: green for hits, red for missed past notes (after tolerance);
  // during idle phase, fall back to "highlight currently sounding notes".
  const computedColors = useMemo<Record<string, string>>(() => {
    const musicxml = control.musicxml;
    if (!musicxml) {
      return {};
    }

    if (phase === "playing" || phase === "complete") {
      const range = control.measureRange;
      const startBeat = range ? (range.from - 1) * musicxml.timeSigNum : 0;
      const endBeat = range
        ? range.to * musicxml.timeSigNum
        : musicxml.totalBeats;
      // In complete phase, treat all selection notes as past.
      const effectiveBeat =
        phase === "complete" ? Number.POSITIVE_INFINITY : control.currentBeat;
      const colors: Record<string, string> = {};
      for (const note of musicxml.notes) {
        if (note.tieStop) {
          continue;
        }
        if (note.startBeat < startBeat || note.startBeat >= endBeat) {
          continue;
        }
        const id = noteKey(note);
        if (hitNoteIds.has(id)) {
          colors[id] = "#2e7d32"; // green: correctly played
        } else if (note.startBeat < effectiveBeat - settings.timingBeats) {
          colors[id] = "#c62828"; // red: missed
        }
      }
      return colors;
    }

    // Idle / counting-in: behave like listen mode — highlight sounding notes.
    return currentlySoundingColors(
      musicxml.notes,
      control.currentBeat,
      settings.accent,
    );
  }, [
    control.musicxml,
    control.measureRange,
    control.currentBeat,
    phase,
    hitNoteIds,
    settings.timingBeats,
    settings.accent,
  ]);
  const noteColors = useStableNoteColors(computedColors);

  const overlay =
    phase === "counting-in" ? (
      <CountInOverlay countInBeat={countInBeat} />
    ) : null;

  const modal = resultModal ? (
    <PlayalongResultModal
      theme={settings.theme}
      accent={settings.accent}
      selectionLabel={resultModal.selectionLabel}
      history={resultModal.history}
      onClose={() => {
        setResultModal(null);
        // Keep phase="complete" so green/red note colors remain for review.
        // Seek to start so the sheet is positioned at the beginning.
        const ctrl = controlRef.current;
        const mx = ctrl.musicxml;
        const range = ctrl.measureRange;
        const startBeat = range && mx ? (range.from - 1) * mx.timeSigNum : 0;
        ctrl.player.seek(startBeat);
        ctrl.setCursor(startBeat, "jump");
      }}
    />
  ) : null;

  return {
    noteColors,
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

function currentlySoundingColors(
  notes: PlaybackNote[],
  currentBeat: number,
  accent: string,
): Record<string, string> {
  if (currentBeat === 0) {
    return {};
  }
  const colors: Record<string, string> = {};
  for (const note of notes) {
    if (
      note.startBeat <= currentBeat &&
      currentBeat < note.startBeat + note.durationBeats
    ) {
      colors[
        `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`
      ] = accent;
    }
  }
  return colors;
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
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
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
