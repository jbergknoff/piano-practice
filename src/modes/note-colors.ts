import { useRef } from "preact/hooks";

function sameColors(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Preserve the previous note-color map reference when its contents are
 * unchanged. The mode hooks recompute the map whenever currentBeat advances
 * (many times per second), but the active-note set only changes a few times per
 * second. Returning a stable reference lets the memoized NoteColorOverlay skip
 * re-rendering between actual color changes.
 */
export function useStableNoteColors(
  colors: Record<string, string>,
): Record<string, string> {
  const ref = useRef(colors);
  if (ref.current !== colors && !sameColors(ref.current, colors)) {
    ref.current = colors;
  }
  return ref.current;
}
