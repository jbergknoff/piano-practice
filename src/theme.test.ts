import { describe, expect, test } from "bun:test";
import { color, colorValue, focusRangeTint, withAlpha } from "./theme";

describe("colours", () => {
  test("every colour token is a variable the injected stylesheet defines", () => {
    const stylesheet =
      document.getElementById("app-color-variables")?.textContent ?? "";
    for (const token of Object.keys(color) as (keyof typeof color)[]) {
      const match = /^var\((--color-[a-z-]+)\)$/.exec(color[token]);
      expect(match).not.toBeNull();
      expect(stylesheet).toContain(`${match?.[1]}: ${colorValue[token]};`);
    }
    expect(color.inkSoft).toBe("var(--color-ink-soft)");
  });

  test("withAlpha mixes any colour with transparency", () => {
    expect(withAlpha(color.accent, 0.35)).toBe(
      "color-mix(in srgb, var(--color-accent) 35%, transparent)",
    );
    expect(withAlpha("#000000", 0x18 / 255)).toBe(
      "color-mix(in srgb, #000000 9.4%, transparent)",
    );
  });

  test("the focus-range tint is the accent at 9% opacity", () => {
    expect(colorValue.accent).toBe("#E08A3E");
    expect(focusRangeTint).toBe("rgba(224,138,62,0.09)");
  });
});
