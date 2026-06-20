import { describe, expect, test } from "bun:test";
import { render } from "preact";
import { Editor } from "./Editor";

// Smoke test: mount the full Editor shell into the linkedom DOM (set up in
// src/test-setup.ts) and confirm it renders an SVG staff and the toolbar, so
// the component wiring (hooks, EditableSheetMusic, the blank document) holds
// together — coverage the dom-edit / hit-test unit tests do not provide.
describe("Editor", () => {
  test("mounts and renders a staff with the toolbar", () => {
    const container = document.createElement("div");
    render(<Editor />, container as unknown as Element);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Five staff lines for the single treble staff of the blank document.
    const staffLines = Array.from(svg?.querySelectorAll("line") ?? []).filter(
      (line) => line.getAttribute("stroke-width") === "0.8",
    );
    expect(staffLines.length).toBe(5);

    // The duration palette and the Import/Export controls are present.
    const labels = Array.from(container.querySelectorAll("button, label")).map(
      (el) => el.textContent,
    );
    expect(labels).toContain("Quarter");
    expect(labels).toContain("Export");
  });
});
