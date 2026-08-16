import { useCallback, useEffect, useState } from "preact/hooks";

/**
 * Fullscreen + landscape-orientation controller.
 *
 * The two are deliberately coupled: `screen.orientation.lock()` is only
 * permitted while the document is fullscreen, so the single button this backs
 * does both at once. Platform reality:
 *
 * - **Android (Chrome/Firefox)** — both work, and the orientation lock even
 *   overrides the OS rotation-lock setting.
 * - **Desktop** — fullscreen works, the orientation lock rejects (there is no
 *   orientation to lock). That rejection is expected and swallowed.
 * - **iPhone Safari** — neither exists; `supported` is false and the button
 *   renders nothing rather than offering something that can't work.
 *
 * An installed PWA gets landscape from the manifest's `orientation` field
 * instead, with no button involved (again, Android only — iOS ignores it).
 */
export interface FullscreenController {
  /** False when the browser exposes no fullscreen API (notably iPhone Safari). */
  supported: boolean;
  isFullscreen: boolean;
  /** Enter fullscreen + lock landscape, or exit + unlock. */
  toggle: () => void;
}

function currentFullscreenElement(): Element | null {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

function fullscreenSupported(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const element = document.documentElement;
  const hasApi =
    typeof element.requestFullscreen === "function" ||
    typeof element.webkitRequestFullscreen === "function";
  // `fullscreenEnabled` is false when a permissions policy forbids fullscreen
  // (e.g. embedded in an iframe without `allow="fullscreen"`).
  const allowed =
    document.fullscreenEnabled || document.webkitFullscreenEnabled === true;
  return hasApi && allowed;
}

function enterFullscreenAndLockLandscape(): Promise<void> {
  const element = document.documentElement;
  const request =
    element.requestFullscreen?.bind(element) ??
    element.webkitRequestFullscreen?.bind(element);
  if (!request) {
    return Promise.reject(new Error("no fullscreen API"));
  }
  // The lock's rejection is swallowed here rather than by the caller, so a
  // caller can still tell "fullscreen was refused" (worth retrying) apart from
  // "there was no orientation to lock" (expected on desktop, nothing to do).
  return Promise.resolve(request()).then(() => {
    void Promise.resolve(screen.orientation?.lock?.("landscape")).catch(
      () => {},
    );
  });
}

/**
 * How long an armed restore stays live. Long enough to survive picking a file
 * out of a deep folder tree, short enough that an abandoned picker can't yank
 * someone into fullscreen on an unrelated tap much later.
 */
const RESTORE_WINDOW_MS = 60_000;

let restoreTimer: ReturnType<typeof setTimeout> | undefined;

/** Drop an armed restore (also called once one has been spent). */
function cancelFullscreenRestore(): void {
  if (restoreTimer === undefined) {
    return;
  }
  clearTimeout(restoreTimer);
  restoreTimer = undefined;
  document.removeEventListener("visibilitychange", onPageReturned);
  window.removeEventListener("focus", onPageReturned);
  window.removeEventListener("pointerup", onUserGesture, true);
  window.removeEventListener("keydown", onUserGesture, true);
}

/**
 * The page is in the foreground again, so the picker is done with. Try to go
 * straight back to fullscreen: it costs nothing, and if the browser refuses
 * (`requestFullscreen` wants transient activation, which returning from another
 * activity does not give) the gesture listeners are still armed.
 */
function onPageReturned(): void {
  if (currentFullscreenElement() !== null) {
    cancelFullscreenRestore();
    return;
  }
  if (document.visibilityState !== "visible") {
    return;
  }
  void enterFullscreenAndLockLandscape()
    .then(cancelFullscreenRestore)
    .catch(() => {});
}

/**
 * The user's first tap/keypress after the picker — the first moment there is
 * transient activation to spend, so this is the attempt that actually lands on
 * Android. Runs in the capture phase so the activation is still live.
 */
function onUserGesture(event: Event): void {
  const target = event.target;
  // A tap on the fullscreen button itself is that button's to interpret;
  // restoring from underneath it would fight its own toggle.
  const onFullscreenButton =
    target instanceof Element && target.closest("[data-fullscreen-toggle]");
  const shouldRestore =
    !onFullscreenButton && currentFullscreenElement() === null;
  cancelFullscreenRestore();
  if (shouldRestore) {
    void enterFullscreenAndLockLandscape().catch(() => {});
  }
}

/**
 * Keep fullscreen across a native file picker. Call this immediately before
 * anything that opens one.
 *
 * On Android the picker is a separate system activity, so opening it drops the
 * page out of fullscreen — and out of the landscape lock with it — before the
 * page sees anything it could veto. Nothing can prevent that, so instead the
 * intent is remembered and fullscreen re-entered as soon as the browser will
 * allow it: on return to the foreground if that is permitted, otherwise on the
 * user's next tap or keypress.
 *
 * A no-op when the page is not fullscreen to begin with (nothing to restore),
 * which is also why a user who leaves fullscreen deliberately — Escape, the
 * Android back gesture, the button — is never dragged back in: only opening a
 * picker *from* fullscreen ever arms this.
 */
export function preserveFullscreenAcrossPicker(): void {
  if (typeof document === "undefined" || currentFullscreenElement() === null) {
    return;
  }
  cancelFullscreenRestore();
  restoreTimer = setTimeout(cancelFullscreenRestore, RESTORE_WINDOW_MS);
  document.addEventListener("visibilitychange", onPageReturned);
  window.addEventListener("focus", onPageReturned);
  window.addEventListener("pointerup", onUserGesture, true);
  window.addEventListener("keydown", onUserGesture, true);
}

export function useFullscreen(): FullscreenController {
  const [supported] = useState(fullscreenSupported);
  const [isFullscreen, setIsFullscreen] = useState(
    () => supported && currentFullscreenElement() !== null,
  );

  useEffect(() => {
    if (!supported) {
      return;
    }
    // Fullscreen can also be left by a route the app never sees (Escape, the
    // Android back gesture, a swipe-down), so the button's state follows the
    // document rather than whatever the last click asked for.
    const onChange = () => {
      setIsFullscreen(currentFullscreenElement() !== null);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [supported]);

  const toggle = useCallback(() => {
    if (!supported) {
      return;
    }
    // An explicit press settles the question of where the user wants to be, so
    // any restore still armed from a file picker is no longer speaking for them.
    cancelFullscreenRestore();

    if (currentFullscreenElement() !== null) {
      screen.orientation?.unlock?.();
      const exit =
        document.exitFullscreen?.bind(document) ??
        document.webkitExitFullscreen?.bind(document);
      // Both the exit and the request below can reject for reasons entirely
      // outside the app's control; a failed toggle is not worth surfacing.
      void Promise.resolve(exit?.()).catch(() => {});
      return;
    }

    void enterFullscreenAndLockLandscape().catch(() => {});
  }, [supported]);

  return { supported, isFullscreen, toggle };
}
