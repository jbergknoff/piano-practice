import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { MidiConversionResult, PlaybackNote } from "./midi-to-musicxml";

export interface PlayalongStats {
  score: number; // 0–100
}

export type PlayalongPhase = "idle" | "counting-in" | "playing" | "complete";

export interface PlayalongModeHandle {
  phase: PlayalongPhase;
  phaseRef: { current: PlayalongPhase };
  hitNoteIds: ReadonlySet<string>;
  onNoteEvent: (noteNumber: number, kind: "on" | "off") => void;
  startCountIn: () => void;
  startPlaying: () => void;
  abort: () => void;
  notifyEnd: () => void;
}

function noteKey(note: PlaybackNote): string {
  return `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
}

export function usePlayalongMode(
  musicxml: MidiConversionResult | null,
  measureRange: { from: number; to: number } | null,
  currentBeatRef: { current: number },
  toleranceBeats: number,
  onComplete: (stats: PlayalongStats) => void,
): PlayalongModeHandle {
  const [phase, setPhase] = useState<PlayalongPhase>("idle");
  const [hitNoteIds, setHitNoteIds] = useState<ReadonlySet<string>>(new Set());

  const phaseRef = useRef<PlayalongPhase>("idle");
  const hitNoteIdsRef = useRef<Set<string>>(new Set());
  const extraNoteCountRef = useRef(0);
  const toleranceBeatRef = useRef(toleranceBeats);
  const measureRangeRef = useRef(measureRange);
  const musicxmlRef = useRef(musicxml);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    toleranceBeatRef.current = toleranceBeats;
  }, [toleranceBeats]);
  useEffect(() => {
    measureRangeRef.current = measureRange;
  }, [measureRange]);
  useEffect(() => {
    musicxmlRef.current = musicxml;
  }, [musicxml]);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Reset when musicxml changes (new file loaded).
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger; ref mutations don't need to be listed
  useEffect(() => {
    phaseRef.current = "idle";
    setPhase("idle");
    hitNoteIdsRef.current = new Set();
    setHitNoteIds(new Set());
    extraNoteCountRef.current = 0;
  }, [musicxml]);

  // Notes in the current selection (not tie-continuations).
  const selectionNotes = useMemo<PlaybackNote[]>(() => {
    if (!musicxml) {
      return [];
    }
    const range = measureRange;
    const startBeat = range ? (range.from - 1) * musicxml.timeSigNum : 0;
    const endBeat = range
      ? range.to * musicxml.timeSigNum
      : musicxml.totalBeats;
    return musicxml.notes.filter(
      (n) => !n.tieStop && n.startBeat >= startBeat && n.startBeat < endBeat,
    );
  }, [musicxml, measureRange]);

  const selectionNotesRef = useRef(selectionNotes);
  useEffect(() => {
    selectionNotesRef.current = selectionNotes;
  }, [selectionNotes]);

  // F1-style score: harmonic mean of precision and recall.
  // precision = matched / (matched + extra)  →  penalises wrong notes
  // recall    = matched / expected           →  penalises missed notes
  // score     = 2 * matched / (expected + matched + extra)
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

  function startCountIn() {
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;
    phaseRef.current = "counting-in";
    setPhase("counting-in");
  }

  function startPlaying() {
    if (phaseRef.current !== "counting-in") {
      return;
    }
    phaseRef.current = "playing";
    setPhase("playing");
  }

  function abort() {
    phaseRef.current = "idle";
    setPhase("idle");
    const empty = new Set<string>();
    hitNoteIdsRef.current = empty;
    setHitNoteIds(empty);
    extraNoteCountRef.current = 0;
  }

  function notifyEnd() {
    if (phaseRef.current !== "playing") {
      return;
    }
    phaseRef.current = "complete";
    setPhase("complete");
    const score = computeScore();
    onCompleteRef.current({ score });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads only from refs; stable by design
  const onNoteEvent = useCallback((noteNumber: number, kind: "on" | "off") => {
    if (phaseRef.current !== "playing" || kind !== "on") {
      return;
    }

    const beat = currentBeatRef.current;
    const notes = selectionNotesRef.current;
    const tol = toleranceBeatRef.current;

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
  }, []);

  return {
    phase,
    phaseRef,
    hitNoteIds,
    onNoteEvent,
    startCountIn,
    startPlaying,
    abort,
    notifyEnd,
  };
}
