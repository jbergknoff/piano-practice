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

    if (currentFullscreenElement() !== null) {
      screen.orientation?.unlock?.();
      const exit =
        document.exitFullscreen?.bind(document) ??
        document.webkitExitFullscreen?.bind(document);
      // Both the exit and the lock below can reject for reasons entirely
      // outside the app's control; a failed toggle is not worth surfacing.
      void Promise.resolve(exit?.()).catch(() => {});
      return;
    }

    const element = document.documentElement;
    const request =
      element.requestFullscreen?.bind(element) ??
      element.webkitRequestFullscreen?.bind(element);
    void Promise.resolve(request?.())
      .then(() => screen.orientation?.lock?.("landscape"))
      .catch(() => {});
  }, [supported]);

  return { supported, isFullscreen, toggle };
}
