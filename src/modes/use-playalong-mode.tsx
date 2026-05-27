import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { PlaybackNote } from "../../lib/midi/midi-to-musicxml";
import {
  formatDate,
  ResultModal,
  type ResultRow,
  ScoreChip,
} from "../components/ResultModal";
import {
  type PlayalongAttempt,
  loadPlayalongAttemptHistory,
  savePlayalongAttempt,
} from "../hooks/use-file-history";
import type { ThemeTokens } from "../theme";
import { blurFilter } from "../theme";
import type { ModeControl, ModeHandle } from "./mode-control";
import { useStableNoteColors } from "./note-colors";

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

  // Reset when musicxml changes (new file loaded).
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger
  useEffect(() => {
    countInCancelRef.current?.();
    countInCancelRef.current = null;
    uninstallAudioRoutingRef.current?.();
    uninstallAudioRoutingRef.current = null;
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = null;
    stopMetronome();
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
    stopMetronome();
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
    const startBeat = range ? (range.from - 1) * mx.timeSigNum : 0;
    player.seek(startBeat);
    ctrl.setCursor(startBeat, "jump");

    // Reset score state.
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;
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
              const startBeat =
                range && mx ? (range.from - 1) * mx.timeSigNum : 0;
              ctrl.player.seek(startBeat);
              ctrl.setCursor(startBeat, "jump");
            }}
          />
        );
      })()
    : null;

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
