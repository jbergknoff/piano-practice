const STORAGE_PREFIX = "piano-practice:file:";

export interface FileHistory {
  bpmRatio: number;
  measureRange: { from: number; to: number } | null;
  mode: "wait" | "race" | "listen";
  selectedTrackIndices: number[];
  currentBeat: number;
  noteSensitivityMilliseconds: number;
  playalongTimingBeats?: number;
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

export interface WaitModeAttempt {
  timestamp: number;
  wrongNotes: number;
  elapsedMs: number;
}

type AttemptHistory = Record<string, WaitModeAttempt[]>;

const ATTEMPTS_PREFIX = "piano-practice:attempts:";
const MAX_ATTEMPTS_PER_SELECTION = 50;

export interface PlayalongAttempt {
  timestamp: number;
  score: number; // 0–100
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

const RECENT_FILE_KEY = "piano-practice:recent-file";

export function saveRecentFile(name: string, bytes: Uint8Array): void {
  try {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    localStorage.setItem(
      RECENT_FILE_KEY,
      JSON.stringify({ name, data: btoa(binary) }),
    );
  } catch {
    // ignore (quota exceeded, etc.)
  }
}

export function loadRecentFile(): {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
} | null {
  try {
    const raw = localStorage.getItem(RECENT_FILE_KEY);
    if (!raw) {
      return null;
    }
    const record = JSON.parse(raw) as { name: string; data: string };
    if (typeof record.name !== "string" || typeof record.data !== "string") {
      return null;
    }
    const binary = atob(record.data);
    const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { name: record.name, bytes };
  } catch {
    return null;
  }
}
