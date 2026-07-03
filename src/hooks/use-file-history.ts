const STORAGE_PREFIX = "piano-practice:file:";

export interface FileHistory {
  bpmRatio: number;
  measureRange: { from: number; to: number } | null;
  mode: "wait" | "playalong" | "listen";
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

export function loadFileHistory(hash: string): FileHistory | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + hash);
    if (!raw) {
      return null;
    }
    const h = JSON.parse(raw) as FileHistory & {
      showFocus?: boolean;
      waitModeActive?: boolean;
    };
    if (typeof h.bpmRatio !== "number" || h.bpmRatio <= 0) {
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
    return h as FileHistory;
  } catch {
    return null;
  }
}

export function saveFileHistory(hash: string, history: FileHistory): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + hash, JSON.stringify(history));
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export function deleteFileHistory(hash: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + hash);
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export interface WaitModeAttempt {
  timestamp: number;
  wrongNotes: number;
  elapsedMs: number;
  score: number; // 0–100, computed at save time
}

type AttemptHistory = Record<string, WaitModeAttempt[]>;

const ATTEMPTS_PREFIX = "piano-practice:attempts:";
const MAX_ATTEMPTS_PER_SELECTION = 50;

export interface PlayalongAttempt {
  timestamp: number;
  score: number; // 0–100
  bpm: number;
}

type PlayalongAttemptHistory = Record<string, PlayalongAttempt[]>;

const PLAYALONG_ATTEMPTS_PREFIX = "piano-practice:playalong-attempts:";

export function loadAttemptHistory(hash: string): AttemptHistory {
  try {
    const raw = localStorage.getItem(ATTEMPTS_PREFIX + hash);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as AttemptHistory;
  } catch {
    return {};
  }
}

export function saveAttempt(
  hash: string,
  selectionKey: string,
  attempt: WaitModeAttempt,
): void {
  try {
    const history = loadAttemptHistory(hash);
    const list = history[selectionKey] ?? [];
    list.push(attempt);
    if (list.length > MAX_ATTEMPTS_PER_SELECTION) {
      list.splice(0, list.length - MAX_ATTEMPTS_PER_SELECTION);
    }
    history[selectionKey] = list;
    localStorage.setItem(ATTEMPTS_PREFIX + hash, JSON.stringify(history));
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export function deleteAttempt(
  hash: string,
  selectionKey: string,
  timestamp: number,
): WaitModeAttempt[] {
  try {
    const history = loadAttemptHistory(hash);
    const list = (history[selectionKey] ?? []).filter(
      (a) => a.timestamp !== timestamp,
    );
    history[selectionKey] = list;
    localStorage.setItem(ATTEMPTS_PREFIX + hash, JSON.stringify(history));
    return list;
  } catch {
    return [];
  }
}

export function clearAttempts(hash: string, selectionKey: string): void {
  try {
    const history = loadAttemptHistory(hash);
    history[selectionKey] = [];
    localStorage.setItem(ATTEMPTS_PREFIX + hash, JSON.stringify(history));
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

// Removes both the wait-mode and playalong attempt logs for a hash entirely
// (every selection key), used when a piece is removed from the library.
export function deleteAllAttempts(hash: string): void {
  try {
    localStorage.removeItem(ATTEMPTS_PREFIX + hash);
    localStorage.removeItem(PLAYALONG_ATTEMPTS_PREFIX + hash);
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export function loadPlayalongAttemptHistory(
  hash: string,
): PlayalongAttemptHistory {
  try {
    const raw = localStorage.getItem(PLAYALONG_ATTEMPTS_PREFIX + hash);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as PlayalongAttemptHistory;
  } catch {
    return {};
  }
}

export function savePlayalongAttempt(
  hash: string,
  selectionKey: string,
  attempt: PlayalongAttempt,
): void {
  try {
    const history = loadPlayalongAttemptHistory(hash);
    const list = history[selectionKey] ?? [];
    list.push(attempt);
    if (list.length > MAX_ATTEMPTS_PER_SELECTION) {
      list.splice(0, list.length - MAX_ATTEMPTS_PER_SELECTION);
    }
    history[selectionKey] = list;
    localStorage.setItem(
      PLAYALONG_ATTEMPTS_PREFIX + hash,
      JSON.stringify(history),
    );
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export function deletePlayalongAttempt(
  hash: string,
  selectionKey: string,
  timestamp: number,
): PlayalongAttempt[] {
  try {
    const history = loadPlayalongAttemptHistory(hash);
    const list = (history[selectionKey] ?? []).filter(
      (a) => a.timestamp !== timestamp,
    );
    history[selectionKey] = list;
    localStorage.setItem(
      PLAYALONG_ATTEMPTS_PREFIX + hash,
      JSON.stringify(history),
    );
    return list;
  } catch {
    return [];
  }
}

export function clearPlayalongAttempts(
  hash: string,
  selectionKey: string,
  bpm: number,
): void {
  try {
    const history = loadPlayalongAttemptHistory(hash);
    history[selectionKey] = (history[selectionKey] ?? []).filter(
      (a) => a.bpm !== bpm,
    );
    localStorage.setItem(
      PLAYALONG_ATTEMPTS_PREFIX + hash,
      JSON.stringify(history),
    );
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export interface CustomRange {
  id: string;
  name: string;
  from: number;
  to: number;
}

const CUSTOM_RANGES_PREFIX = "piano-practice:custom-ranges:";

export function loadCustomRanges(hash: string): CustomRange[] {
  try {
    const raw = localStorage.getItem(CUSTOM_RANGES_PREFIX + hash);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomRange[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomRanges(hash: string, ranges: CustomRange[]): void {
  try {
    localStorage.setItem(CUSTOM_RANGES_PREFIX + hash, JSON.stringify(ranges));
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export function deleteAllCustomRanges(hash: string): void {
  try {
    localStorage.removeItem(CUSTOM_RANGES_PREFIX + hash);
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export interface GlobalPreferences {
  playalongPlayMusic: boolean;
  playalongMetronome: boolean;
  playalongCountIn: boolean;
}

const GLOBAL_PREFERENCES_KEY = "piano-practice:preferences";

export function loadGlobalPreferences(): GlobalPreferences {
  try {
    const raw = localStorage.getItem(GLOBAL_PREFERENCES_KEY);
    if (!raw) {
      return {
        playalongPlayMusic: true,
        playalongMetronome: false,
        playalongCountIn: true,
      };
    }
    const parsed = JSON.parse(raw) as Partial<GlobalPreferences>;
    return {
      playalongPlayMusic: parsed.playalongPlayMusic ?? true,
      playalongMetronome: parsed.playalongMetronome ?? false,
      playalongCountIn: parsed.playalongCountIn ?? true,
    };
  } catch {
    return {
      playalongPlayMusic: true,
      playalongMetronome: false,
      playalongCountIn: true,
    };
  }
}

export function saveGlobalPreferences(prefs: GlobalPreferences): void {
  try {
    localStorage.setItem(GLOBAL_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // ignore (private mode, quota exceeded, etc.)
  }
}

export interface LibrarySummary {
  lastPracticedAt: number | null;
  mode: "wait" | "playalong" | "listen" | null;
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
