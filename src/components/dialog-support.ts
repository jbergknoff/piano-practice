import { useEffect, useRef } from "preact/hooks";

// Structural CSS for the native <dialog>/popover elements behind `Modal`,
// `Drawer` and the context menu. It has to be a stylesheet rather than inline
// styles because it targets things inline styles can't reach: `::backdrop`,
// the `[open]` state, `@starting-style`, and the UA defaults for <dialog> and
// [popover] (border, padding, Canvas colours, auto margins, max sizes) that
// would otherwise leak into the app's own panel styling. Colours, spacing and
// sizes stay inline at each call site, as everywhere else in the app.
//
// Injected once per document at module load (same pattern as the sheet-music
// glyph font), so it is in place before any dialog first renders.
const DIALOG_CSS = `
.app-modal {
  position: fixed;
  inset: auto;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  max-width: none;
  max-height: none;
  overflow: visible;
}
.app-modal::backdrop {
  background: rgba(0, 0, 0, 0.3);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.app-drawer {
  position: fixed;
  inset: 0 auto 0 auto;
  height: auto;
  margin: 0;
  border: none;
  color: inherit;
  max-width: none;
  max-height: none;
  transition:
    transform 0.32s cubic-bezier(0.32, 0.72, 0.36, 1),
    overlay 0.32s allow-discrete,
    display 0.32s allow-discrete;
}
.app-drawer[data-side="left"] { left: 0; transform: translateX(-100%); }
.app-drawer[data-side="right"] { right: 0; transform: translateX(100%); }
.app-drawer[open] {
  display: flex;
  flex-direction: column;
  transform: none;
}
.app-drawer:not([open]) { pointer-events: none; }
.app-drawer::backdrop {
  background: rgba(0, 0, 0, 0);
  transition:
    background-color 0.25s ease,
    overlay 0.25s allow-discrete,
    display 0.25s allow-discrete;
}
.app-drawer[open]::backdrop { background: rgba(0, 0, 0, 0.18); }
@starting-style {
  .app-drawer[open][data-side="left"] { transform: translateX(-100%); }
  .app-drawer[open][data-side="right"] { transform: translateX(100%); }
  .app-drawer[open]::backdrop { background: rgba(0, 0, 0, 0); }
}
.app-modal:focus,
.app-drawer:focus {
  outline: none;
}
.app-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  overflow: visible;
}
`;

function injectDialogStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  const elementId = "app-dialog-styles";
  if (document.getElementById(elementId)) {
    return;
  }
  const style = document.createElement("style");
  style.id = elementId;
  style.textContent = DIALOG_CSS;
  document.head.appendChild(style);
}
injectDialogStyles();

/**
 * Closes a modal <dialog> when the user clicks its backdrop. A click on the
 * `::backdrop` is dispatched to the <dialog> itself, so the test is "the target
 * is the dialog and the point lies outside its box". The press must also have
 * *started* outside: a drag that begins inside the panel (e.g. selecting text)
 * and is released over the backdrop also targets the dialog, and must not
 * close it.
 *
 * Attached with addEventListener rather than an `onClick` prop: this is not a
 * control a keyboard user needs (Escape closes every dialog natively), so it
 * shouldn't pose as one.
 */
export function useCloseOnBackdropClick(
  dialogRef: { current: HTMLDialogElement | null },
  onClose: () => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    function isOnBackdrop(event: MouseEvent): boolean {
      if (event.target !== dialog || !dialog) {
        return false;
      }
      const box = dialog.getBoundingClientRect();
      return (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      );
    }
    let pressStartedOnBackdrop = false;
    function onPointerDown(event: PointerEvent) {
      pressStartedOnBackdrop = isOnBackdrop(event);
    }
    function onClick(event: MouseEvent) {
      if (pressStartedOnBackdrop && isOnBackdrop(event)) {
        onCloseRef.current();
      }
      pressStartedOnBackdrop = false;
    }
    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("click", onClick);
    };
  }, [dialogRef]);
}
