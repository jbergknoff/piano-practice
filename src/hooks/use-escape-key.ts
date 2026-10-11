import { useEffect, useRef } from "preact/hooks";

/**
 * Calls `onEscape` when Escape is pressed anywhere in the document while
 * `enabled` is true. Modals and drawers use this instead of an `onKeyDown` on
 * their backdrop: keydown is dispatched to the focused element and bubbles
 * through its ancestors, and a backdrop is neither focusable nor an ancestor of
 * the modal's content, so a handler there never fires.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onEscapeRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
