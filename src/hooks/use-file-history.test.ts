import { beforeEach, describe, expect, test } from "bun:test";
import {
  type Bookmark,
  computeLibrarySummary,
  loadBookmarks,
  saveAttempt,
  saveBookmarks,
  saveFileHistory,
  savePlayalongAttempt,
} from "./use-file-history";

beforeEach(() => {
  localStorage.clear();
});

describe("computeLibrarySummary", () => {
  test("returns nulls when nothing has been saved for the hash", () => {
    expect(computeLibrarySummary("unknown")).toEqual({
      lastPracticedAt: null,
      mode: null,
      bestScore: null,
    });
  });

  test("aggregates the best score and latest timestamp across selection keys and attempt kinds", () => {
    const hash = "hash1";
    saveFileHistory(hash, {
      bpmRatio: 1,
      measureRange: null,
      mode: "playalong",
      selectedTrackIndices: [],
      currentBeat: 0,
    });
    saveAttempt(hash, "full", {
      timestamp: 1000,
      wrongNotes: 2,
      elapsedMs: 100,
      score: 70,
    });
    saveAttempt(hash, "m1-m8", {
      timestamp: 3000,
      wrongNotes: 0,
      elapsedMs: 100,
      score: 95,
    });
    savePlayalongAttempt(hash, "full", {
      timestamp: 2000,
      score: 60,
      bpm: 100,
    });

    const summary = computeLibrarySummary(hash);
    expect(summary.mode).toBe("playalong");
    expect(summary.bestScore).toBe(95);
    expect(summary.lastPracticedAt).toBe(3000);
  });
});

// TODO(after August 2026): delete alongside the migration itself.
describe("legacy bookmark migration", () => {
  const LEGACY_KEY = "piano-practice:custom-ranges:hash1";
  const NEW_KEY = "piano-practice:bookmarks:hash1";
  const legacyBookmarks: Bookmark[] = [
    { id: "a", name: "Tricky run", from: 3, to: 7 },
  ];

  test("moves bookmarks off the old key when nothing is stored under the new one", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBookmarks));

    expect(loadBookmarks("hash1")).toEqual(legacyBookmarks);
    // Moved, not copied — the legacy key is cleaned up so the migration is
    // a one-time event.
    expect(localStorage.getItem(NEW_KEY)).toBe(JSON.stringify(legacyBookmarks));
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  test("leaves an existing new-key value alone", () => {
    const current: Bookmark[] = [{ id: "b", name: "Coda", from: 1, to: 2 }];
    saveBookmarks("hash1", current);
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBookmarks));

    expect(loadBookmarks("hash1")).toEqual(current);
  });

  // An empty array under the new key is a real value (the user deleted their
  // last bookmark), not an absent one — re-seeding it from the stale legacy
  // copy would resurrect deleted bookmarks.
  test("does not resurrect legacy bookmarks after the last one is deleted", () => {
    saveBookmarks("hash1", []);
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBookmarks));

    expect(loadBookmarks("hash1")).toEqual([]);
  });

  test("returns an empty list when neither key exists", () => {
    expect(loadBookmarks("hash1")).toEqual([]);
    expect(localStorage.getItem(NEW_KEY)).toBeNull();
  });
});
