// Editor shell: owns the live MusicXML Document, the duration palette, the
// selection, and import/export. The Document is the source of truth (held in a
// ref); a `version` counter forces a re-render after each in-place mutation, and
// the serialized string is recomputed from it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  beatsForDuration,
  DurationPalette,
} from "./components/DurationPalette";
import {
  EditableSheetMusic,
  type EditorGesture,
} from "./components/EditableSheetMusic";
import {
  addNote,
  createBlankDocument,
  moveNote,
  type NoteHandle,
  parseDocument,
  removeNote,
  serializeDocument,
} from "./dom-edit";
import { idForHandle, locateBeat } from "./hit-test";
import {
  computeMeasureStartBeats,
  type NoteHighlight,
  type NoteType,
  parseScore,
} from "./sheet-music/index";

const SELECTION_COLOR = "#1976d2";

export function Editor() {
  const documentRef = useRef<Document | null>(null);
  if (documentRef.current === null) {
    documentRef.current = createBlankDocument();
  }
  const [version, setVersion] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState<NoteType>("quarter");
  const [selectedHandle, setSelectedHandle] = useState<NoteHandle | null>(null);

  // Bump the version after every document mutation so the render recomputes.
  const commit = useCallback(() => setVersion((v) => v + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version drives re-serialize after in-place mutations
  const musicxml = useMemo(
    () => serializeDocument(documentRef.current as Document),
    [version],
  );
  const score = useMemo(() => parseScore(musicxml), [musicxml]);
  const measureStartBeats = useMemo(
    () => computeMeasureStartBeats(score),
    [score],
  );

  // The selection follows its note across edits via the (stable) handle; the
  // renderer id is re-derived each render from the freshly parsed score.
  const selectedId = selectedHandle ? idForHandle(score, selectedHandle) : null;
  const noteHighlights: NoteHighlight[] = selectedId
    ? [{ kind: "score", id: selectedId, color: SELECTION_COLOR }]
    : [];

  // Tracks an in-progress note drag (its current handle is updated as moveNote
  // re-fits and rewrites the note on each pointer move).
  const dragRef = useRef<{ handle: NoteHandle } | null>(null);

  const handleGestureDown = useCallback(
    (gesture: EditorGesture) => {
      const doc = documentRef.current as Document;
      if (gesture.hit) {
        setSelectedHandle(gesture.hit.handle);
        dragRef.current = { handle: gesture.hit.handle };
        return;
      }
      // Empty staff: place a note of the selected duration.
      const { measureIndex, onsetBeatInMeasure } = locateBeat(
        gesture.beat,
        measureStartBeats,
      );
      const handle = addNote(doc, {
        measureIndex,
        onsetBeatInMeasure,
        durationBeats: beatsForDuration(selectedDuration),
        pitch: gesture.pitch,
      });
      if (handle) {
        setSelectedHandle(handle);
      }
      commit();
    },
    [commit, measureStartBeats, selectedDuration],
  );

  const handleGestureMove = useCallback(
    (gesture: EditorGesture) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const doc = documentRef.current as Document;
      const { measureIndex, onsetBeatInMeasure } = locateBeat(
        gesture.beat,
        measureStartBeats,
      );
      const handle = moveNote(doc, drag.handle, {
        measureIndex,
        onsetBeatInMeasure,
        pitch: gesture.pitch,
      });
      if (handle) {
        drag.handle = handle;
        setSelectedHandle(handle);
        commit();
      }
    },
    [commit, measureStartBeats],
  );

  const handleGestureUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedHandle) {
      return;
    }
    removeNote(documentRef.current as Document, selectedHandle);
    setSelectedHandle(null);
    commit();
  }, [commit, selectedHandle]);

  // Delete / Backspace removes the selected note.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected]);

  const onImport = useCallback(
    async (event: Event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const text = await file.text();
      documentRef.current = parseDocument(text);
      setSelectedHandle(null);
      commit();
      input.value = "";
    },
    [commit],
  );

  const onExport = useCallback(() => {
    const blob = new Blob([musicxml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "score.musicxml";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [musicxml]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        height: "100%",
        boxSizing: "border-box",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <DurationPalette
          value={selectedDuration}
          onChange={setSelectedDuration}
        />
        <button
          type="button"
          onClick={deleteSelected}
          disabled={!selectedHandle}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#fff",
            color: selectedHandle ? "#333" : "#aaa",
            cursor: selectedHandle ? "pointer" : "default",
            fontSize: 14,
          }}
        >
          Delete
        </button>
        <span style={{ flex: 1 }} />
        <label
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Import
          <input
            type="file"
            accept=".musicxml,.xml"
            onChange={onImport}
            style={{ display: "none" }}
          />
        </label>
        <button
          type="button"
          onClick={onExport}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#fff",
            color: "#333",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Export
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <EditableSheetMusic
          musicxml={musicxml}
          noteHighlights={noteHighlights}
          onGestureDown={handleGestureDown}
          onGestureMove={handleGestureMove}
          onGestureUp={handleGestureUp}
        />
      </div>
    </div>
  );
}
