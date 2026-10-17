import { useLayoutEffect, useRef } from "preact/hooks";

// The structural CSS these dialogs need (::backdrop, the drawer's states,
// resetting the UA's <dialog> defaults) lives in src/styles.css.

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

  // A layout effect, so the listeners are attached in the same commit that
  // calls showModal(). Preact defers a plain useEffect until after paint,
  // leaving a window where the dialog already blocks the page but a backdrop
  // click does nothing.
  useLayoutEffect(() => {
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
