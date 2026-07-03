// DOM polyfills for Bun's test runner, which does not ship DOM APIs.
// linkedom is a spec-compliant implementation used only during testing. A full
// window/document is provided (not just DOMParser) so Preact components can be
// rendered into a real node tree and their SVG output inspected — see
// renderSheetMusic in SheetMusicDisplay.test.tsx.
import "fake-indexeddb/auto";
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

// Minimal XMLSerializer stub for linkedom (which exposes outerHTML but not
// XMLSerializer).  Used by expand-repeats.ts when running under Bun/linkedom.
class XMLSerializerStub {
  serializeToString(node: { outerHTML?: string; toString(): string }): string {
    return node.outerHTML ?? node.toString();
  }
}

// Minimal in-memory localStorage polyfill — neither Bun's test runner nor
// linkedom provides one, but use-file-history.ts/use-file-library.ts need it.
class LocalStorageStub {
  #store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#store.has(key) ? (this.#store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.#store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.#store.delete(key);
  }
  clear(): void {
    this.#store.clear();
  }
}

Object.assign(globalThis, {
  DOMParser,
  XMLSerializer: XMLSerializerStub,
  window,
  document,
  ResizeObserver: ResizeObserverStub,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  getComputedStyle: () => ({ paddingLeft: "0px" }),
  localStorage: new LocalStorageStub(),
});
