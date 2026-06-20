/**
 * One coloured element drawn on the staff. Two flavours:
 * - `score` recolours an existing notehead identified by its score `id`
 *   (`p{partIndex}-m{measureNumber}-n{noteIndex}-v{voiceIndex}`).
 * - `marker` draws a new circle at an arbitrary (beat, pitch) — used by
 *   callers (e.g. a play-along mode) to show where keys were actually pressed.
 *
 * This is the display component's own public API; consumers build these
 * entries and pass them through the `noteHighlights` prop.
 */
export type ScoreHighlight = { kind: "score"; id: string; color: string };
export type MarkerHighlight = {
  kind: "marker";
  noteNumber: number;
  beat: number;
  color: string;
};
export type NoteHighlight = ScoreHighlight | MarkerHighlight;
