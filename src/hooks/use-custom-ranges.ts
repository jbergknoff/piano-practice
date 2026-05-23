import { useCallback, useEffect, useState } from "preact/hooks";
import {
  type CustomRange,
  loadCustomRanges,
  saveCustomRanges,
} from "./use-file-history";

// "create" saves the current selection as a new named range; "edit" renames
// (or deletes) an existing one.
export type RangeEditorState =
  | { kind: "create"; from: number; to: number }
  | { kind: "edit"; range: CustomRange };

function defaultRangeName(range: { from: number; to: number }): string {
  return range.from === range.to
    ? `Measure ${range.from}`
    : `Measures ${range.from}–${range.to}`;
}

// Owns the per-file list of named ranges (persisted in local storage) and the
// state for the naming/editing modal.
export function useCustomRanges(fileHash: string | null) {
  const [ranges, setRanges] = useState<CustomRange[]>([]);
  useEffect(() => {
    setRanges(fileHash ? loadCustomRanges(fileHash) : []);
  }, [fileHash]);

  const persist = useCallback(
    (next: CustomRange[]) => {
      setRanges(next);
      if (fileHash) {
        saveCustomRanges(fileHash, next);
      }
    },
    [fileHash],
  );

  const [editor, setEditor] = useState<RangeEditorState | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const openCreate = useCallback((range: { from: number; to: number }) => {
    setEditor({ kind: "create", from: range.from, to: range.to });
    setNameDraft(defaultRangeName(range));
  }, []);

  const openEdit = useCallback((range: CustomRange) => {
    setEditor({ kind: "edit", range });
    setNameDraft(range.name);
  }, []);

  const closeEditor = useCallback(() => setEditor(null), []);

  const saveEditor = useCallback(() => {
    if (!editor) {
      return;
    }
    const name = nameDraft.trim();
    if (!name) {
      return;
    }
    if (editor.kind === "create") {
      persist([
        ...ranges,
        { id: crypto.randomUUID(), name, from: editor.from, to: editor.to },
      ]);
    } else {
      persist(
        ranges.map((r) => (r.id === editor.range.id ? { ...r, name } : r)),
      );
    }
    setEditor(null);
  }, [editor, nameDraft, ranges, persist]);

  const deleteEditing = useCallback(() => {
    if (editor?.kind !== "edit") {
      return;
    }
    persist(ranges.filter((r) => r.id !== editor.range.id));
    setEditor(null);
  }, [editor, ranges, persist]);

  return {
    ranges,
    editor,
    nameDraft,
    setNameDraft,
    openCreate,
    openEdit,
    closeEditor,
    saveEditor,
    deleteEditing,
  };
}
