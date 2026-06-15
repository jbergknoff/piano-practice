import { describe, expect, test } from "bun:test";
import { EMBEDDED_GLYPH_CODEPOINTS } from "./embedded-glyph-font";
import { RENDERED_GLYPH_CODEPOINTS } from "./glyphs";

// Drift guard: the committed font subset must cover every glyph the renderer can
// draw. If this fails, a glyph was added to glyphs.ts without regenerating the
// embedded subset — run `make generate-glyph-font`.
describe("embedded glyph font", () => {
  test("covers every codepoint the renderer can emit", () => {
    const embedded = new Set(EMBEDDED_GLYPH_CODEPOINTS);
    const missing = RENDERED_GLYPH_CODEPOINTS.filter(
      (codepoint) => !embedded.has(codepoint),
    ).map((codepoint) => `U+${codepoint.toString(16).toUpperCase()}`);
    expect(missing).toEqual([]);
  });
});
