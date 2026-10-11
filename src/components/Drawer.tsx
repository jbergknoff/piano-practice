import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { useCloseOnBackdropClick } from "./dialog-support";

/**
 * A full-height panel that slides in from one side, built on a native
 * `<dialog>` opened with `showModal()` — so, like `Modal`, it gets the top
 * layer, Escape to close, and an inert page behind it.
 *
 * Unlike `Modal` it stays mounted and is driven by `open`, so it can animate
 * out as well as in. The slide is CSS (`.app-drawer` in dialog-support.ts):
 * `@starting-style` gives the entry transition, and transitioning `display`
 * and `overlay` with `allow-discrete` keeps the closing dialog rendered in the
 * top layer until it has slid away. Browsers without those features simply
 * skip the animation.
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
  /**
   * The panel's own look (width, background, padding, gap). Children are laid
   * out in a column by the stylesheet, which sets `display` only while the
   * drawer is open: an inline `display` here would override the browser's
   * `display: none` for a closed dialog and keep it rendered.
   */
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
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape closes the dialog natively; report it so the caller's `open` state
  // follows. A close we caused ourselves (open became false) reports back too,
  // which is harmless: the caller is just told to close what is already closed.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    function onNativeClose() {
      onCloseRef.current();
    }
    dialog.addEventListener("close", onNativeClose);
    return () => dialog.removeEventListener("close", onNativeClose);
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
