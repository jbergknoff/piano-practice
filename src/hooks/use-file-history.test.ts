import { beforeEach, describe, expect, test } from "bun:test";
import {
  computeLibrarySummary,
  deleteAllAttempts,
  deleteAllCustomRanges,
  deleteFileHistory,
  loadAttemptHistory,
  loadCustomRanges,
  loadFileHistory,
  loadPlayalongAttemptHistory,
  saveAttempt,
  saveCustomRanges,
  saveFileHistory,
  savePlayalongAttempt,
} from "./use-file-history";

beforeEach(() => {
  localStorage.clear();
});

describe("deleteFileHistory / deleteAllAttempts / deleteAllCustomRanges", () => {
  test("each removes only its own store for the given hash", () => {
    const hash = "hash1";
    saveFileHistory(hash, {
      bpmRatio: 1,
      measureRange: null,
      mode: "wait",
      selectedTrackIndices: [],
      currentBeat: 0,
    });
    saveAttempt(hash, "full", {
      timestamp: 1,
      wrongNotes: 0,
      elapsedMs: 10,
      score: 90,
    });
    savePlayalongAttempt(hash, "full", { timestamp: 1, score: 80, bpm: 100 });
    saveCustomRanges(hash, [{ id: "1", name: "Intro", from: 1, to: 4 }]);

    deleteFileHistory(hash);
    expect(loadFileHistory(hash)).toBeNull();
    expect(loadAttemptHistory(hash).full?.length).toBe(1);

    deleteAllAttempts(hash);
    expect(loadAttemptHistory(hash)).toEqual({});
    expect(loadPlayalongAttemptHistory(hash)).toEqual({});
    expect(loadCustomRanges(hash).length).toBe(1);

    deleteAllCustomRanges(hash);
    expect(loadCustomRanges(hash)).toEqual([]);
  });
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
