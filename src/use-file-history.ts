const STORAGE_PREFIX = "piano-practice:file:";

export interface FileHistory {
  bpmRatio: number;
  measureRange: { from: number; to: number } | null;
  showFocus: boolean;
  selectedTrackIndices: number[];
  currentBeat: number;
  noteSensitivityMilliseconds: number;
  waitModeActive: boolean;
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
    const h = JSON.parse(raw) as FileHistory;
    if (typeof h.bpmRatio !== "number" || h.bpmRatio <= 0) {
      return null;
    }
    return h;
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
