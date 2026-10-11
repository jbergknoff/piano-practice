import { useEffect } from "preact/hooks";

/**
 * Requests a screen wake lock while `active` is true, so the display doesn't
 * sleep during a practice session. The lock is automatically re-acquired when
 * the page becomes visible again (e.g. after a tab switch), because the browser
 * releases it whenever the document is hidden.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) {
      return;
    }

    let lock: WakeLockSentinel | null = null;
    let released = false;

    async function acquire() {
      if (released) {
        return;
      }
      try {
        const acquired = await navigator.wakeLock.request("screen");
        // The effect may have been cleaned up while the request was pending;
        // its cleanup released whatever `lock` held then, so release this one
        // here or it would stay held for the rest of the session.
        if (released) {
          void acquired.release();
          return;
        }
        lock = acquired;
      } catch {
        // Permission denied or feature unavailable — silently ignore.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        acquire();
      }
    }

    acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      lock?.release();
    };
  }, [active]);
}
