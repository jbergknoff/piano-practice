import { describe, expect, test } from "bun:test";
import { adjacentRange, type NamedRange } from "./selection";

function bookmark(name: string, from: number, to: number): NamedRange {
  return { name, from, to };
}

describe("adjacentRange", () => {
  test("whole piece has no neighbours", () => {
    expect(adjacentRange(null, "next", 32, [])).toBeNull();
    expect(adjacentRange(null, "previous", 32, [])).toBeNull();
  });

  test("slides the window by its own length when nothing is bookmarked", () => {
    expect(adjacentRange({ from: 19, to: 20 }, "next", 32, [])).toEqual({
      name: "Measures 21–22",
      from: 21,
      to: 22,
    });
    expect(adjacentRange({ from: 19, to: 20 }, "previous", 32, [])).toEqual({
      name: "Measures 17–18",
      from: 17,
      to: 18,
    });
  });

  test("clamps the slid window to the piece and stops at the edges", () => {
    expect(adjacentRange({ from: 29, to: 31 }, "next", 32, [])).toEqual({
      name: "Measure 32",
      from: 32,
      to: 32,
    });
    expect(adjacentRange({ from: 2, to: 4 }, "previous", 32, [])).toEqual({
      name: "Measure 1",
      from: 1,
      to: 1,
    });
    expect(adjacentRange({ from: 31, to: 32 }, "next", 32, [])).toBeNull();
    expect(adjacentRange({ from: 1, to: 2 }, "previous", 32, [])).toBeNull();
  });

  test("prefers an adjacent bookmark, even of a different length", () => {
    const bookmarks = [bookmark("Run", 21, 23), bookmark("Coda", 24, 32)];
    expect(adjacentRange({ from: 19, to: 20 }, "next", 32, bookmarks)).toEqual(
      bookmarks[0],
    );
    expect(
      adjacentRange({ from: 24, to: 32 }, "previous", 32, bookmarks),
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
      adjacentRange({ from: 19, to: 20 }, "next", 32, bookmarks)?.name,
    ).toBe("One");
    // Current length 3: "Three" matches exactly.
    expect(
      adjacentRange({ from: 18, to: 20 }, "next", 32, bookmarks)?.name,
    ).toBe("Three");
  });

  test("from a half, slides to the other half", () => {
    expect(adjacentRange({ from: 1, to: 16 }, "next", 32, [])).toEqual({
      name: "Measures 17–32",
      from: 17,
      to: 32,
    });
  });
});
