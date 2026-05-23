import { useEffect, useRef } from "preact/hooks";
import type { RangeEditorState } from "../hooks/use-custom-ranges";
import type { ThemeTokens } from "../theme";

interface RangeNameModalProps {
  editor: RangeEditorState;
  nameDraft: string;
  onNameDraftChange: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  theme: ThemeTokens;
  accent: string;
}

const fontFamily = "'Geist', ui-sans-serif, system-ui, sans-serif";

export function RangeNameModal({
  editor,
  nameDraft,
  onNameDraftChange,
  onSave,
  onCancel,
  onDelete,
  theme,
  accent,
}: RangeNameModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const range = editor.kind === "create" ? editor : editor.range;
  const rangeLabel =
    range.from === range.to
      ? `Measure ${range.from}`
      : `Measures ${range.from}–${range.to}`;
  const canSave = nameDraft.trim().length > 0;

  return (
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.3)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
        onClick={onCancel}
        onKeyDown={(e) => {
          if ((e as unknown as KeyboardEvent).key === "Escape") {
            onCancel();
          }
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 200,
          background: theme.panel,
          border: `0.5px solid ${theme.border}`,
          borderRadius: 16,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          padding: "24px 28px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          width: 300,
          maxWidth: "calc(100vw - 48px)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontStyle: "italic",
            fontSize: 24,
            color: theme.ink,
            marginBottom: 4,
          }}
        >
          {editor.kind === "create" ? "Name this range" : "Edit range"}
        </div>
        <div style={{ fontSize: 11, color: theme.inkSoft, marginBottom: 16 }}>
          {rangeLabel}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={nameDraft}
          placeholder="e.g. Tricky run"
          onInput={(e) =>
            onNameDraftChange((e.target as HTMLInputElement).value)
          }
          onKeyDown={(e) => {
            if ((e as unknown as KeyboardEvent).key === "Enter") {
              onSave();
            }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            fontSize: 14,
            color: theme.ink,
            background: theme.panelSolid,
            border: `0.5px solid ${theme.border}`,
            borderRadius: 10,
            outline: "none",
            fontFamily,
            marginBottom: 18,
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div>
            {editor.kind === "edit" && (
              <button
                type="button"
                onClick={onDelete}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#c62828",
                  cursor: "pointer",
                  fontSize: 13,
                  padding: "8px 4px",
                  outline: "none",
                  fontFamily,
                }}
              >
                Delete
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "transparent",
                border: `0.5px solid ${theme.border}`,
                color: theme.ink,
                cursor: "pointer",
                fontSize: 13,
                padding: "8px 16px",
                borderRadius: 10,
                outline: "none",
                fontFamily,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              style={{
                background: accent,
                border: "none",
                color: "#FFF7E5",
                cursor: canSave ? "pointer" : "not-allowed",
                opacity: canSave ? 1 : 0.4,
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 16px",
                borderRadius: 10,
                outline: "none",
                fontFamily,
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
