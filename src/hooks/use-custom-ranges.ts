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
export function useCustomRanges(
  fileHash: string | null,
  totalMeasures: number,
  // Called with the bounds that were just saved for a new ("create") range —
  // lets the caller sync the active focus range to match, since the create
  // modal's From/To fields may have been edited away from whatever range (if
  // any) was focused when the modal was opened.
  onRangeCreated?: (range: { from: number; to: number }) => void,
) {
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
  // Only meaningful while editor.kind === "create" — the editable from/to
  // text inputs, kept as strings so the fields can hold intermediate
  // (invalid) input while typing.
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");

  const openCreate = useCallback((range: { from: number; to: number }) => {
    setEditor({ kind: "create", from: range.from, to: range.to });
    setNameDraft(defaultRangeName(range));
    setFromDraft(String(range.from));
    setToDraft(String(range.to));
  }, []);

  const openEdit = useCallback((range: CustomRange) => {
    setEditor({ kind: "edit", range });
    setNameDraft(range.name);
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
        ...ranges,
        {
          id: crypto.randomUUID(),
          name,
          from: parsedBounds.from,
          to: parsedBounds.to,
        },
      ]);
      onRangeCreated?.(parsedBounds);
    } else {
      persist(
        ranges.map((r) => (r.id === editor.range.id ? { ...r, name } : r)),
      );
    }
    setEditor(null);
  }, [editor, nameDraft, parsedBounds, ranges, persist, onRangeCreated]);

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
