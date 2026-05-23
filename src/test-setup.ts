// DOM polyfills for Bun's test runner, which does not ship DOM APIs.
// linkedom is a spec-compliant implementation used only during testing. A full
// window/document is provided (not just DOMParser) so Preact components can be
// rendered into a real node tree and their SVG output inspected — see
// renderSheetMusic in SheetMusicDisplay.test.tsx.
import { DOMParser, parseHTML } from "linkedom";

const { window, document } = parseHTML(
  "<!DOCTYPE html><html><head></head><body></body></html>",
);

// Stubs for the browser APIs that SheetMusicDisplay's effects reach for. They
// only run during live playback (gated on isPlaying/getLiveBeat), so no-ops are
// enough to keep a static render from throwing if its effects flush.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.assign(globalThis, {
  DOMParser,
  window,
  document,
  ResizeObserver: ResizeObserverStub,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  getComputedStyle: () => ({ paddingLeft: "0px" }),
});
