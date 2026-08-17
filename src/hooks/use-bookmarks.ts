import { useCallback, useEffect, useState } from "preact/hooks";
import { selectionLabelForRange } from "../selection";
import {
  type Bookmark,
  loadBookmarks,
  saveBookmarks,
} from "./use-file-history";

// "create" saves the current selection as a new bookmark; "edit" renames (or
// deletes) an existing one.
export type BookmarkEditorState =
  | { kind: "create"; from: number; to: number }
  | { kind: "edit"; bookmark: Bookmark };

// Owns the per-file list of bookmarks (persisted in local storage) and the
// state for the bookmark/rename modal.
export function useBookmarks(
  fileHash: string | null,
  totalMeasures: number,
  // Called with the bounds that were just saved for a new ("create") bookmark
  // — lets the caller sync the active focus range to match, since the create
  // modal's From/To fields may have been edited away from whatever range (if
  // any) was focused when the modal was opened.
  onBookmarkCreated?: (range: { from: number; to: number }) => void,
) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  useEffect(() => {
    setBookmarks(fileHash ? loadBookmarks(fileHash) : []);
  }, [fileHash]);

  const persist = useCallback(
    (next: Bookmark[]) => {
      setBookmarks(next);
      if (fileHash) {
        saveBookmarks(fileHash, next);
      }
    },
    [fileHash],
  );

  const [editor, setEditor] = useState<BookmarkEditorState | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  // Only meaningful while editor.kind === "create" — the editable from/to
  // text inputs, kept as strings so the fields can hold intermediate
  // (invalid) input while typing.
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");

  const openCreate = useCallback((range: { from: number; to: number }) => {
    setEditor({ kind: "create", from: range.from, to: range.to });
    setNameDraft(selectionLabelForRange(range));
    setFromDraft(String(range.from));
    setToDraft(String(range.to));
  }, []);

  const openEdit = useCallback((bookmark: Bookmark) => {
    setEditor({ kind: "edit", bookmark });
    setNameDraft(bookmark.name);
  }, []);

  const closeEditor = useCallback(() => setEditor(null), []);

  const parsedBounds = (() => {
    if (editor?.kind !== "create") {
      return null;
    }
    const from = Number.parseInt(fromDraft, 10);
    const to = Number.parseInt(toDraft, 10);
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to < from ||
      to > totalMeasures
    ) {
      return null;
    }
    return { from, to };
  })();

  const saveEditor = useCallback(() => {
    if (!editor) {
      return;
    }
    const name = nameDraft.trim();
    if (!name) {
      return;
    }
    if (editor.kind === "create") {
      if (!parsedBounds) {
        return;
      }
      persist([
        ...bookmarks,
        {
          id: crypto.randomUUID(),
          name,
          from: parsedBounds.from,
          to: parsedBounds.to,
        },
      ]);
      onBookmarkCreated?.(parsedBounds);
    } else {
      persist(
        bookmarks.map((b) =>
          b.id === editor.bookmark.id ? { ...b, name } : b,
        ),
      );
    }
    setEditor(null);
  }, [editor, nameDraft, parsedBounds, bookmarks, persist, onBookmarkCreated]);

  const deleteEditing = useCallback(() => {
    if (editor?.kind !== "edit") {
      return;
    }
    persist(bookmarks.filter((b) => b.id !== editor.bookmark.id));
    setEditor(null);
  }, [editor, bookmarks, persist]);

  return {
    bookmarks,
    editor,
    nameDraft,
    setNameDraft,
    fromDraft,
    setFromDraft,
    toDraft,
    setToDraft,
    boundsValid: parsedBounds !== null,
    openCreate,
    openEdit,
    closeEditor,
    saveEditor,
    deleteEditing,
  };
}
