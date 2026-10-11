import { describe, expect, test } from "bun:test";
import { adjacentSection, type NamedRange, presetRanges } from "./selection";

function bookmark(name: string, from: number, to: number): NamedRange {
  return { name, from, to };
}

describe("adjacentSection", () => {
  test("whole piece has no neighbours", () => {
    expect(adjacentSection(null, "next", 32, [], [])).toBeNull();
    expect(adjacentSection(null, "previous", 32, [], [])).toBeNull();
  });

  test("slides the window by its own length when nothing is bookmarked", () => {
    expect(adjacentSection({ from: 19, to: 20 }, "next", 32, [], [])).toEqual({
      name: "Measures 21–22",
      from: 21,
      to: 22,
    });
    expect(
      adjacentSection({ from: 19, to: 20 }, "previous", 32, [], []),
    ).toEqual({ name: "Measures 17–18", from: 17, to: 18 });
  });

  test("clamps the slid window to the piece and stops at the edges", () => {
    expect(adjacentSection({ from: 29, to: 31 }, "next", 32, [], [])).toEqual({
      name: "Measure 32",
      from: 32,
      to: 32,
    });
    expect(adjacentSection({ from: 2, to: 4 }, "previous", 32, [], [])).toEqual(
      { name: "Measure 1", from: 1, to: 1 },
    );
    expect(
      adjacentSection({ from: 31, to: 32 }, "next", 32, [], []),
    ).toBeNull();
    expect(
      adjacentSection({ from: 1, to: 2 }, "previous", 32, [], []),
    ).toBeNull();
  });

  test("prefers an adjacent bookmark, even of a different length", () => {
    const bookmarks = [bookmark("Run", 21, 23), bookmark("Coda", 24, 32)];
    expect(
      adjacentSection({ from: 19, to: 20 }, "next", 32, bookmarks, []),
    ).toEqual(bookmarks[0]);
    expect(
      adjacentSection({ from: 24, to: 32 }, "previous", 32, bookmarks, []),
    ).toEqual(bookmarks[0]);
  });

  test("among adjacent bookmarks, picks the closest length, then the shorter", () => {
    const bookmarks = [
      bookmark("Long", 21, 28),
      bookmark("Three", 21, 23),
      bookmark("One", 21, 21),
    ];
    // Current length 2: "One" (diff 1) and "Three" (diff 1) tie; shorter wins.
    expect(
      adjacentSection({ from: 19, to: 20 }, "next", 32, bookmarks, [])?.name,
    ).toBe("One");
    // Current length 3: "Three" matches exactly.
    expect(
      adjacentSection({ from: 18, to: 20 }, "next", 32, bookmarks, [])?.name,
    ).toBe("Three");
  });

  test("steps within an ordered series the current range belongs to", () => {
    const { halves, quarters } = presetRanges(32);
    const series = [halves, quarters];
    expect(adjacentSection({ from: 1, to: 8 }, "next", 32, [], series)).toEqual(
      { name: "Q2", from: 9, to: 16 },
    );
    expect(
      adjacentSection({ from: 17, to: 32 }, "previous", 32, [], series),
    ).toEqual({ name: "First half", from: 1, to: 16 });
    // The end of a series is the end — no sliding past Q4.
    expect(
      adjacentSection({ from: 25, to: 32 }, "next", 32, [], series),
    ).toBeNull();
  });

  test("a series wins over an adjacent bookmark that starts in the same place", () => {
    const { halves, quarters } = presetRanges(32);
    const bookmarks = [bookmark("Bridge", 9, 10)];
    expect(
      adjacentSection({ from: 1, to: 8 }, "next", 32, bookmarks, [
        halves,
        quarters,
      ])?.name,
    ).toBe("Q2");
  });
});

describe("presetRanges", () => {
  test("omits halves and quarters for pieces too short to split", () => {
    expect(presetRanges(1)).toEqual({ halves: [], quarters: [] });
    expect(presetRanges(3).quarters).toEqual([]);
    expect(presetRanges(3).halves).toEqual([
      { name: "First half", from: 1, to: 1 },
      { name: "Second half", from: 2, to: 3 },
    ]);
  });
});
