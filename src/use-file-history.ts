const STORAGE_PREFIX = "piano-practice:file:";

export interface FileHistory {
  bpmRatio: number;
  measureRange: { from: number; to: number } | null;
  showFocus: boolean;
  selectedTrackIndices: number[];
  currentBeat: number;
  noteSensitivityMilliseconds: number;
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
