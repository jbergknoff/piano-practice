import type { PracticeMode } from "../modes/mode-control";
import type { MeasureRange } from "../selection";

const STORAGE_PREFIX = "piano-practice:file:";

export interface FileHistory {
  bpmRatio: number;
  measureRange: MeasureRange | null;
  mode: PracticeMode;
  selectedTrackIndices: number[];
  currentBeat: number;
}

export async function hashFileBytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Every localStorage read/write in this file goes through these two
// primitives, so quota-exceeded / private-mode / malformed-JSON failures are
// handled once (silently: reads fall back to the caller-supplied default,
// writes are dropped) instead of in every load/save function individually.
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export function loadFileHistory(hash: string): FileHistory | null {
  const h = loadJson<
    (FileHistory & { showFocus?: boolean; waitModeActive?: boolean }) | null
  >(STORAGE_PREFIX + hash, null);
  if (!h || typeof h.bpmRatio !== "number" || h.bpmRatio <= 0) {
    return null;
  }
  // Normalize old format that used showFocus + waitModeActive
  if (!h.mode) {
    h.mode = h.waitModeActive === false ? "listen" : "wait";
  }
  // Normalize old "race" value to "playalong"
  if ((h.mode as string) === "race") {
    h.mode = "playalong";
  }
  return h;
}

export function saveFileHistory(hash: string, history: FileHistory): void {
  saveJson(STORAGE_PREFIX + hash, history);
}

export interface WaitModeAttempt {
  timestamp: number;
  wrongNotes: number;
  elapsedMs: number;
  score: number; // 0–100, computed at save time
}

export interface PlayalongAttempt {
  timestamp: number;
  score: number; // 0–100
  bpm: number;
}

const MAX_ATTEMPTS_PER_SELECTION = 50;

/**
 * Builds the load/save/delete/clear operations shared by the wait-mode and
 * playalong attempt logs — they differ only in storage prefix, attempt shape,
 * and (for "clear") which attempts a caller wants removed.
 */
function createAttemptStore<T extends { timestamp: number }>(prefix: string) {
  function loadHistory(hash: string): Record<string, T[]> {
    return loadJson(prefix + hash, {});
  }

  function saveAttempt(hash: string, selectionKey: string, attempt: T): void {
    const history = loadHistory(hash);
    const list = history[selectionKey] ?? [];
    list.push(attempt);
    if (list.length > MAX_ATTEMPTS_PER_SELECTION) {
      list.splice(0, list.length - MAX_ATTEMPTS_PER_SELECTION);
    }
    history[selectionKey] = list;
    saveJson(prefix + hash, history);
  }

  function deleteAttempt(
    hash: string,
    selectionKey: string,
    timestamp: number,
  ): T[] {
    const history = loadHistory(hash);
    const list = (history[selectionKey] ?? []).filter(
      (a) => a.timestamp !== timestamp,
    );
    history[selectionKey] = list;
    saveJson(prefix + hash, history);
    return list;
  }

  function clearMatching(
    hash: string,
    selectionKey: string,
    predicate: (attempt: T) => boolean,
  ): void {
    const history = loadHistory(hash);
    history[selectionKey] = (history[selectionKey] ?? []).filter(
      (a) => !predicate(a),
    );
    saveJson(prefix + hash, history);
  }

  return { loadHistory, saveAttempt, deleteAttempt, clearMatching };
}

const ATTEMPTS_PREFIX = "piano-practice:attempts:";
const waitAttempts = createAttemptStore<WaitModeAttempt>(ATTEMPTS_PREFIX);

export const loadAttemptHistory = waitAttempts.loadHistory;
export const saveAttempt = waitAttempts.saveAttempt;
export const deleteAttempt = waitAttempts.deleteAttempt;

export function clearAttempts(hash: string, selectionKey: string): void {
  waitAttempts.clearMatching(hash, selectionKey, () => true);
}

const PLAYALONG_ATTEMPTS_PREFIX = "piano-practice:playalong-attempts:";
const playalongAttempts = createAttemptStore<PlayalongAttempt>(
  PLAYALONG_ATTEMPTS_PREFIX,
);

export const loadPlayalongAttemptHistory = playalongAttempts.loadHistory;
export const savePlayalongAttempt = playalongAttempts.saveAttempt;
export const deletePlayalongAttempt = playalongAttempts.deleteAttempt;

export function clearPlayalongAttempts(
  hash: string,
  selectionKey: string,
  bpm: number,
): void {
  playalongAttempts.clearMatching(hash, selectionKey, (a) => a.bpm === bpm);
}

/** A user-named measure range — surfaced in the UI as a "bookmark". */
export interface Bookmark {
  id: string;
  name: string;
  from: number;
  to: number;
}

const BOOKMARKS_PREFIX = "piano-practice:bookmarks:";

// The prefix bookmarks were stored under before the feature was renamed from
// "custom ranges" to "bookmarks".
// TODO(after August 2026): delete LEGACY_BOOKMARKS_PREFIX and
// migrateLegacyBookmarks, and drop the migrate call from loadBookmarks.
const LEGACY_BOOKMARKS_PREFIX = "piano-practice:custom-ranges:";

/**
 * Moves a hash's bookmarks from the old "custom-ranges" key to the new
 * "bookmarks" one, once, on first read after the rename. Runs only when the
 * new key is *absent* — an empty array written under the new key is a real
 * value (the user deleted their last bookmark) and must not be re-seeded from
 * the stale legacy copy.
 */
function migrateLegacyBookmarks(hash: string): void {
  try {
    if (localStorage.getItem(BOOKMARKS_PREFIX + hash) !== null) {
      return;
    }
    const legacy = localStorage.getItem(LEGACY_BOOKMARKS_PREFIX + hash);
    if (legacy === null) {
      return;
    }
    localStorage.setItem(BOOKMARKS_PREFIX + hash, legacy);
    localStorage.removeItem(LEGACY_BOOKMARKS_PREFIX + hash);
  } catch {
    // best-effort (private mode, quota exceeded, etc.) — a failed migration
    // just means the load below falls back to an empty list.
  }
}

export function loadBookmarks(hash: string): Bookmark[] {
  migrateLegacyBookmarks(hash);
  const parsed = loadJson<unknown>(BOOKMARKS_PREFIX + hash, []);
  return Array.isArray(parsed) ? (parsed as Bookmark[]) : [];
}

export function saveBookmarks(hash: string, bookmarks: Bookmark[]): void {
  saveJson(BOOKMARKS_PREFIX + hash, bookmarks);
}

export interface GlobalPreferences {
  playalongPlayMusic: boolean;
  playalongMetronome: boolean;
  playalongCountIn: boolean;
}

const GLOBAL_PREFERENCES_KEY = "piano-practice:preferences";

export function loadGlobalPreferences(): GlobalPreferences {
  const parsed = loadJson<Partial<GlobalPreferences> | null>(
    GLOBAL_PREFERENCES_KEY,
    null,
  );
  return {
    playalongPlayMusic: parsed?.playalongPlayMusic ?? true,
    playalongMetronome: parsed?.playalongMetronome ?? false,
    playalongCountIn: parsed?.playalongCountIn ?? true,
  };
}

export function saveGlobalPreferences(prefs: GlobalPreferences): void {
  saveJson(GLOBAL_PREFERENCES_KEY, prefs);
}

export interface LibrarySummary {
  lastPracticedAt: number | null;
  mode: PracticeMode | null;
  bestScore: number | null;
}

// Aggregates practice stats for a file across every selection key and both
// attempt kinds, for display in the file-library list.
export function computeLibrarySummary(hash: string): LibrarySummary {
  let lastPracticedAt: number | null = null;
  let bestScore: number | null = null;

  for (const list of Object.values(loadAttemptHistory(hash))) {
    for (const attempt of list) {
      lastPracticedAt = Math.max(
        lastPracticedAt ?? Number.NEGATIVE_INFINITY,
        attempt.timestamp,
      );
      bestScore = Math.max(
        bestScore ?? Number.NEGATIVE_INFINITY,
        attempt.score,
      );
    }
  }
  for (const list of Object.values(loadPlayalongAttemptHistory(hash))) {
    for (const attempt of list) {
      lastPracticedAt = Math.max(
        lastPracticedAt ?? Number.NEGATIVE_INFINITY,
        attempt.timestamp,
      );
      bestScore = Math.max(
        bestScore ?? Number.NEGATIVE_INFINITY,
        attempt.score,
      );
    }
  }

  return {
    lastPracticedAt,
    mode: loadFileHistory(hash)?.mode ?? null,
    bestScore,
  };
}
