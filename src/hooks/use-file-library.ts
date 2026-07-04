import { hashFileBytes } from "./use-file-history";

const DB_NAME = "piano-practice";
const DB_VERSION = 1;
const STORE_NAME = "library";

export interface LibraryEntry {
  hash: string;
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
  addedAt: number;
  lastOpenedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "hash" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const result = await promisifyRequest(fn(tx.objectStore(STORE_NAME)));
    return result;
  } finally {
    db.close();
  }
}

export async function putLibraryEntry(
  hash: string,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  try {
    const existing = await getLibraryEntry(hash);
    const entry: LibraryEntry = {
      hash,
      fileName,
      bytes,
      addedAt: existing?.addedAt ?? Date.now(),
      lastOpenedAt: Date.now(),
    };
    await withStore("readwrite", (store) => store.put(entry));
  } catch {
    // ignore (quota exceeded, private mode, etc.)
  }
}

export async function getLibraryEntry(
  hash: string,
): Promise<LibraryEntry | null> {
  try {
    const entry = await withStore<LibraryEntry | undefined>(
      "readonly",
      (store) => store.get(hash),
    );
    return entry ?? null;
  } catch {
    return null;
  }
}

export async function getAllLibraryEntries(): Promise<LibraryEntry[]> {
  try {
    return await withStore<LibraryEntry[]>("readonly", (store) =>
      store.getAll(),
    );
  } catch {
    return [];
  }
}

export async function getMostRecentlyOpenedEntry(): Promise<LibraryEntry | null> {
  const entries = await getAllLibraryEntries();
  if (entries.length === 0) {
    return null;
  }
  return entries.reduce((most, e) =>
    e.lastOpenedAt > most.lastOpenedAt ? e : most,
  );
}

// Removes only the cached file bytes for a hash — FileHistory, attempts, and
// custom ranges are left alone, so reopening the same file later (which
// recreates the library entry under the same hash) brings its old practice
// history back automatically.
export async function deleteLibraryEntry(hash: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(hash));
  } catch {
    // ignore (quota exceeded, private mode, etc.)
  }
}

const RECENT_FILE_KEY = "piano-practice:recent-file";
const MIGRATION_FLAG_KEY = "piano-practice:library-migrated-v1";

// One-shot migration from the old single-slot base64-in-localStorage "recent
// file" cache to the IndexedDB library. Runs once ever, gated by a flag key.
export async function migrateRecentFileToLibrary(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY)) {
      return;
    }
    const raw = localStorage.getItem(RECENT_FILE_KEY);
    if (raw) {
      const record = JSON.parse(raw) as { name: string; data: string };
      if (typeof record.name === "string" && typeof record.data === "string") {
        const binary = atob(record.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const hash = await hashFileBytes(bytes);
        await putLibraryEntry(hash, record.name, bytes);
      }
    }
  } catch {
    // best-effort; don't block startup on migration failure
  } finally {
    try {
      localStorage.setItem(MIGRATION_FLAG_KEY, "1");
      localStorage.removeItem(RECENT_FILE_KEY);
    } catch {
      // ignore (private mode, quota exceeded, etc.)
    }
  }
}
