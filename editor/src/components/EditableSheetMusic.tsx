// Wraps the vendored read-only renderer and adds the editing pointer seam.
// It holds no document: it resolves each raw pointer gesture from the staff SVG
// into a musical `{ beat, pitch, hit }` (via hit-test) and reports it up to the
// Editor, which owns the document and applies the dom-edit op. Visual feedback
// is drawn through the renderer's existing `noteHighlights` prop.

import type { NoteHandle } from "../dom-edit";
import { beatFromX, pickNote, pitchFromY } from "../hit-test";
import {
  type NoteHighlight,
  SheetMusicDisplay,
  type StagePointerInfo,
  type Pitch,
} from "../sheet-music/index";

export interface EditorGesture {
  /** Absolute quarter-note beat, snapped to the 16th-note grid. */
  beat: number;
  /** Pitch under the pointer, snapped to the nearest half staff-space. */
  pitch: Pitch;
  /** The note the pointer is over, if any (id for highlight, handle for edits). */
  hit: { id: string; handle: NoteHandle } | null;
}

function resolveGesture(info: StagePointerInfo): EditorGesture {
  const beat = beatFromX(
    info.svgX,
    info.score,
    info.layout,
    info.measureStartBeats,
  );
  // Step 1 edits the single (first) staff.
  const clef = info.score.parts[0]?.clef ?? { sign: "G" as const, line: 2 };
  const staffBottomY = info.layout.staffBottomYs[0] ?? 0;
  const pitch = pitchFromY(
    info.svgY,
    staffBottomY,
    info.layout.staffSpace,
    clef,
  );
  return { beat, pitch, hit: pickNote(info.score, beat, pitch) };
}

export function EditableSheetMusic({
  musicxml,
  noteHighlights,
  onGestureDown,
  onGestureMove,
  onGestureUp,
}: {
  musicxml: string;
  noteHighlights?: ReadonlyArray<NoteHighlight>;
  onGestureDown?: (gesture: EditorGesture, event: PointerEvent) => void;
  onGestureMove?: (gesture: EditorGesture, event: PointerEvent) => void;
  onGestureUp?: (gesture: EditorGesture, event: PointerEvent) => void;
}) {
  return (
    <SheetMusicDisplay
      musicxml={musicxml}
      noteHighlights={noteHighlights}
      textFontFamily="ui-sans-serif, system-ui, sans-serif"
      containerStyle={{ touchAction: "none" }}
      onStagePointerDown={(info, event) =>
        onGestureDown?.(resolveGesture(info), event)
      }
      onStagePointerMove={(info, event) =>
        onGestureMove?.(resolveGesture(info), event)
      }
      onStagePointerUp={(info, event) =>
        onGestureUp?.(resolveGesture(info), event)
      }
    />
  );
}
