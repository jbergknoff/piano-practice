// Pure on/off state machine that turns a per-frame set of detected MIDI notes
// into discrete note-on / note-off events, with hysteresis and debounce.
//
// FFT detection flickers frame-to-frame around the threshold and during a
// note's attack/decay. We require a note to persist for a few frames before
// emitting "on", and to be absent for a (longer) run of frames before emitting
// "off", so a held note isn't dropped during a brief dip below the floor.
//
// Framework-agnostic and synchronous so it unit-tests under `bun test`.

interface NoteState {
  framesPresent: number;
  framesAbsent: number;
  isOn: boolean;
  velocity: number;
}

export interface NoteTrackerState {
  readonly onFrames: number;
  readonly offFrames: number;
  readonly notes: Map<number, NoteState>;
}

export interface NoteTrackerEvent {
  noteNumber: number;
  kind: "on" | "off";
  velocity: number;
}

export function createNoteTracker(options?: {
  onFrames?: number;
  offFrames?: number;
}): NoteTrackerState {
  return {
    onFrames: options?.onFrames ?? 2,
    offFrames: options?.offFrames ?? 4,
    notes: new Map(),
  };
}

// Advances the tracker by one frame. `detected` is the set of MIDI notes seen
// this frame; `velocities` optionally carries a velocity (1..127) per note.
// Returns the on/off events to emit for this frame.
export function trackFrame(
  state: NoteTrackerState,
  detected: Set<number>,
  velocities?: Map<number, number>,
): NoteTrackerEvent[] {
  const events: NoteTrackerEvent[] = [];

  // Ensure every detected note has an entry.
  for (const noteNumber of detected) {
    if (!state.notes.has(noteNumber)) {
      state.notes.set(noteNumber, {
        framesPresent: 0,
        framesAbsent: 0,
        isOn: false,
        velocity: 0,
      });
    }
  }

  for (const [noteNumber, noteState] of state.notes) {
    const isDetected = detected.has(noteNumber);
    if (isDetected) {
      noteState.framesPresent += 1;
      noteState.framesAbsent = 0;
      noteState.velocity = velocities?.get(noteNumber) ?? noteState.velocity;
      if (!noteState.isOn && noteState.framesPresent >= state.onFrames) {
        noteState.isOn = true;
        events.push({
          noteNumber,
          kind: "on",
          velocity: noteState.velocity || 64,
        });
      }
    } else {
      noteState.framesAbsent += 1;
      noteState.framesPresent = 0;
      if (noteState.isOn && noteState.framesAbsent >= state.offFrames) {
        noteState.isOn = false;
        events.push({ noteNumber, kind: "off", velocity: 0 });
      }
    }
  }

  // Drop entries that are fully off and have been absent long enough, to keep
  // the map from growing unbounded over a long session.
  for (const [noteNumber, noteState] of state.notes) {
    if (!noteState.isOn && noteState.framesAbsent > state.offFrames * 4) {
      state.notes.delete(noteNumber);
    }
  }

  return events;
}
