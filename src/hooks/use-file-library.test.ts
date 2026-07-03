import { beforeEach, describe, expect, test } from "bun:test";
import {
  deleteLibraryEntry,
  getAllLibraryEntries,
  getLibraryEntry,
  getMostRecentlyOpenedEntry,
  migrateRecentFileToLibrary,
  putLibraryEntry,
} from "./use-file-library";

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("piano-practice");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  localStorage.clear();
  await deleteDb();
});

describe("putLibraryEntry / getLibraryEntry", () => {
  test("round-trips bytes and metadata", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await putLibraryEntry("hash1", "piece.mid", bytes);
    const entry = await getLibraryEntry("hash1");
    expect(entry).not.toBeNull();
    expect(entry?.fileName).toBe("piece.mid");
    expect(Array.from(entry?.bytes ?? [])).toEqual([1, 2, 3, 4]);
  });

  test("repeat put preserves addedAt but updates lastOpenedAt/bytes/fileName", async () => {
    await putLibraryEntry("hash1", "first.mid", new Uint8Array([1]));
    const first = await getLibraryEntry("hash1");
    await new Promise((r) => setTimeout(r, 5));
    await putLibraryEntry("hash1", "renamed.mid", new Uint8Array([2]));
    const second = await getLibraryEntry("hash1");
    expect(second?.addedAt).toBe(first?.addedAt as number);
    expect(second?.fileName).toBe("renamed.mid");
    expect(Array.from(second?.bytes ?? [])).toEqual([2]);
    expect(second?.lastOpenedAt).toBeGreaterThanOrEqual(
      first?.lastOpenedAt as number,
    );
  });

  test("getLibraryEntry returns null for missing hash", async () => {
    expect(await getLibraryEntry("missing")).toBeNull();
  });
});

describe("getAllLibraryEntries / getMostRecentlyOpenedEntry", () => {
  test("returns multiple entries and picks the most recently opened", async () => {
    await putLibraryEntry("hash-a", "a.mid", new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 5));
    await putLibraryEntry("hash-b", "b.mid", new Uint8Array([2]));

    const all = await getAllLibraryEntries();
    expect(all.length).toBe(2);

    const mostRecent = await getMostRecentlyOpenedEntry();
    expect(mostRecent?.hash).toBe("hash-b");
  });

  test("returns null when the library is empty", async () => {
    expect(await getMostRecentlyOpenedEntry()).toBeNull();
  });
});

describe("deleteLibraryEntry", () => {
  test("removes the record", async () => {
    await putLibraryEntry("hash1", "piece.mid", new Uint8Array([1]));
    await deleteLibraryEntry("hash1");
    expect(await getLibraryEntry("hash1")).toBeNull();
  });
});

describe("migrateRecentFileToLibrary", () => {
  test("moves the old single-slot recent file into the library and removes the old key", async () => {
    let binary = "";
    const bytes = new Uint8Array([10, 20, 30]);
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    localStorage.setItem(
      "piano-practice:recent-file",
      JSON.stringify({ name: "old-piece.mid", data: btoa(binary) }),
    );

    await migrateRecentFileToLibrary();

    expect(localStorage.getItem("piano-practice:recent-file")).toBeNull();
    const entries = await getAllLibraryEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].fileName).toBe("old-piece.mid");
    expect(Array.from(entries[0].bytes)).toEqual([10, 20, 30]);
  });

  test("is a no-op on a second call", async () => {
    localStorage.setItem(
      "piano-practice:recent-file",
      JSON.stringify({ name: "old.mid", data: btoa("x") }),
    );
    await migrateRecentFileToLibrary();

    localStorage.setItem(
      "piano-practice:recent-file",
      JSON.stringify({ name: "should-not-migrate.mid", data: btoa("y") }),
    );
    await migrateRecentFileToLibrary();

    const entries = await getAllLibraryEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].fileName).toBe("old.mid");
  });

  test("does nothing when there is no recent file to migrate", async () => {
    await migrateRecentFileToLibrary();
    expect(await getAllLibraryEntries()).toEqual([]);
  });
});
