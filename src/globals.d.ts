/** Injected at build time by `bun build --define`. */
declare const GIT_COMMIT: string;

/**
 * `screen.orientation.lock()`/`.unlock()` ship in Chromium and Firefox but are
 * absent from Safari, and TypeScript's lib.dom omits them entirely. Declared
 * optional so every call site has to feature-detect (see use-fullscreen.ts).
 */
interface ScreenOrientation {
  lock?: (
    orientation:
      | "any"
      | "natural"
      | "landscape"
      | "portrait"
      | "portrait-primary"
      | "portrait-secondary"
      | "landscape-primary"
      | "landscape-secondary",
  ) => Promise<void>;
  unlock?: () => void;
}

/**
 * Safari (desktop and iPadOS) only exposes the webkit-prefixed fullscreen API;
 * iPhone Safari exposes neither, which is what `fullscreenSupported()` detects.
 */
interface Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
