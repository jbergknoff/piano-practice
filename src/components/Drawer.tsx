import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { useCloseOnBackdropClick } from "./dialog-support";

/**
 * A full-height panel that slides in from one side, built on a native
 * `<dialog>` opened with `showModal()` like `Modal`: top layer, Escape to
 * close, an inert page behind it, and a press on the backdrop closes it.
 *
 * The slide is sequenced around `showModal()`'s cost. Making the rest of the
 * page inert restyles every element: with a long score on screen that is one
 * ~150–250 ms frame on a phone-speed CPU. So nothing moves in that frame:
 *
 * - Opening calls `showModal()` with the panel still offscreen, and only sets
 *   `data-shown` (which slides it in) two frames later, once the costly frame
 *   is behind it.
 * - Closing slides the panel out first and calls `close()` only when the slide
 *   has finished, so the restyle that un-inerts the page happens after the
 *   drawer is already gone.
 *
 * The opening pause can't be avoided with `showModal()`, but neither slide is
 * interrupted by it. (Measured in Chromium at 4× CPU throttling on the full
 * Rondo score: the slide-out starts immediately rather than after a ~200 ms
 * pause, and both slides run with no frame over ~20 ms.)
 *
 * Because `close()` waits for the slide-out, the dialog stays `[open]` (and
 * so displayed and modal) until it is offscreen: no `@starting-style` or
 * `allow-discrete` transitions are needed to animate the exit.
 */
export function Drawer({
  open,
  onClose,
  side,
  label,
  style,
  children,
}: {
  open: boolean;
  /** Called on Escape or a backdrop click; the caller sets `open` to false. */
  onClose: () => void;
  side: "left" | "right";
  label: string;
  /** The panel's own look (width, background, padding, gap). Children are laid out in a column. */
  style: JSX.CSSProperties;
  children: ComponentChildren;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      // Two frames: the first runs before that frame's (costly) restyle, so
      // only the second is past it.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          dialog.dataset.shown = "";
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!dialog.open) {
      return;
    }
    delete dialog.dataset.shown;
    // getAnimations() flushes style, so the slide-out has started by now.
    // With reduced motion (or no transition) it returns nothing and the
    // dialog closes straight away.
    let superseded = false;
    Promise.all(
      dialog
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    ).then(
      () => {
        if (!superseded) {
          dialog.close();
        }
      },
      // Reopened mid-slide: the reversed transition cancels this one.
      () => {},
    );
    return () => {
      superseded = true;
    };
  }, [open]);

  // Escape: slide out instead of the native instant close. The "close" event
  // still reports to the caller in case the browser closes it anyway (Chrome
  // ignores preventDefault on repeated Escapes without a user gesture), and
  // when `close()` above finishes a slide-out, which is harmless.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    function onCancel(event: Event) {
      event.preventDefault();
      onCloseRef.current();
    }
    function onNativeClose() {
      delete dialog?.dataset.shown;
      onCloseRef.current();
    }
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onNativeClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onNativeClose);
    };
  }, []);

  useCloseOnBackdropClick(dialogRef, () => onCloseRef.current());

  return (
    <dialog
      ref={dialogRef}
      class="app-drawer"
      data-side={side}
      aria-label={label}
      style={style}
    >
      {children}
    </dialog>
  );
}
