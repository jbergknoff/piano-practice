import type { PianoSource } from "./use-piano";

const STORAGE_KEY = "piano-practice:preferred-source";

/**
 * The transport that last connected successfully on this origin. It lets the
 * connection badge skip the "Bluetooth or USB?" chooser and go straight to the
 * transport the user actually uses, which matters because the chooser-style
 * APIs (`requestDevice`) need a user gesture — we can't auto-open a picker on
 * load, so the best available shortcut is making the one required tap land in
 * the right place.
 *
 * Only ever written on a *successful* connection, so a failed experiment with
 * the other transport never overwrites a working preference.
 */
export function loadPreferredSource(): PianoSource | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "bluetooth" || raw === "midi" ? raw : null;
  } catch {
    // Private mode / storage disabled — no preference is a fine fallback.
    return null;
  }
}

export function savePreferredSource(source: PianoSource): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}
