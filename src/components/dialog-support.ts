import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

// Structural CSS for the native <dialog> elements behind `Modal`, `Drawer`
// and `ContextMenu`. It has to be a stylesheet rather than inline
// styles because it targets things inline styles can't reach: `::backdrop`,
// and the UA defaults for <dialog>
// (border, padding, Canvas colours, auto margins, max sizes) that
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
  max-width: none;
  max-height: none;
  margin: 0;
  border: none;
  color: inherit;
  flex-direction: column;
  transition: transform 0.32s cubic-bezier(0.32, 0.72, 0.36, 1);
}
/* display only while open, so the UA's display: none still hides it closed. */
.app-drawer[open] { display: flex; }
.app-drawer[data-side="left"] { left: 0; transform: translateX(-100%); }
.app-drawer[data-side="right"] { right: 0; transform: translateX(100%); }
.app-drawer[data-shown] { transform: none; }
.app-drawer::backdrop {
  background: rgba(0, 0, 0, 0.18);
  opacity: 0;
  transition: opacity 0.25s ease;
}
.app-drawer[data-shown]::backdrop { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .app-drawer,
  .app-drawer::backdrop {
    transition: none;
  }
}
.app-modal:focus,
.app-drawer:focus {
  outline: none;
}
.app-menu {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  max-width: none;
  max-height: none;
  overflow: visible;
}
.app-menu::backdrop {
  background: transparent;
}
.app-menu:focus {
  outline: none;
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

/**
 * Opens `dialogRef`'s <dialog> as a modal (`showModal()`) when the component
 * mounts and closes it when it unmounts, reporting user dismissals (Escape, a
 * backdrop click) through `onClose` so the caller can unmount it. `onShow` runs
 * right after `showModal()`, in the same layout effect: the place to focus an
 * input, since `showModal()` itself moves focus into the dialog.
 */
export function useModalDialog(
  dialogRef: { current: HTMLDialogElement | null },
  onClose: () => void,
  onShow?: () => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    dialog.showModal();
    onShowRef.current?.();
    // Escape closes the dialog natively and fires "close"; report it so the
    // caller unmounts us. Closing on unmount below also fires "close" (a task
    // later), which must not be reported back as a dismissal.
    let unmounting = false;
    function onNativeClose() {
      if (!unmounting) {
        onCloseRef.current();
      }
    }
    dialog.addEventListener("close", onNativeClose);
    return () => {
      unmounting = true;
      dialog.removeEventListener("close", onNativeClose);
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [dialogRef]);

  useCloseOnBackdropClick(dialogRef, () => onCloseRef.current());
}
