import { useEffect, useRef } from "preact/hooks";
import type { RangeEditorState } from "../hooks/use-custom-ranges";
import type { ThemeTokens } from "../theme";
import {
  dimBackdrop,
  FONT_SANS,
  glassPanel,
  modalActionButtonStyle,
  serifTitle,
} from "../theme";

interface RangeNameModalProps {
  editor: RangeEditorState;
  nameDraft: string;
  onNameDraftChange: (name: string) => void;
  fromDraft: string;
  onFromDraftChange: (value: string) => void;
  toDraft: string;
  onToDraftChange: (value: string) => void;
  boundsValid: boolean;
  totalMeasures: number;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  theme: ThemeTokens;
  accent: string;
}

export function RangeNameModal({
  editor,
  nameDraft,
  onNameDraftChange,
  fromDraft,
  onFromDraftChange,
  toDraft,
  onToDraftChange,
  boundsValid,
  totalMeasures,
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
  const canSave =
    nameDraft.trim().length > 0 && (editor.kind === "edit" || boundsValid);

  return (
    <>
      <div
        role="presentation"
        style={{ ...dimBackdrop(), zIndex: 199 }}
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
          ...glassPanel(theme, 24, 160),
          borderRadius: 16,
          padding: "24px 28px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          width: 300,
          maxWidth: "calc(100vw - 48px)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ ...serifTitle(theme, 24), marginBottom: 4 }}>
          {editor.kind === "create" ? "Name this range" : "Rename range"}
        </div>
        {editor.kind === "create" ? (
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <label
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 11, color: theme.inkSoft }}>From</span>
              <input
                type="number"
                min={1}
                max={totalMeasures}
                value={fromDraft}
                onInput={(e) =>
                  onFromDraftChange((e.target as HTMLInputElement).value)
                }
                style={boundsInputStyle(theme)}
              />
            </label>
            <label
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 11, color: theme.inkSoft }}>To</span>
              <input
                type="number"
                min={1}
                max={totalMeasures}
                value={toDraft}
                onInput={(e) =>
                  onToDraftChange((e.target as HTMLInputElement).value)
                }
                style={boundsInputStyle(theme)}
              />
            </label>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: theme.inkSoft, marginBottom: 16 }}>
            {rangeLabel}
          </div>
        )}
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
            fontFamily: FONT_SANS,
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
                  fontFamily: FONT_SANS,
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
              style={modalActionButtonStyle(theme, "ghost")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              style={modalActionButtonStyle(theme, "accent", accent, canSave)}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function boundsInputStyle(theme: ThemeTokens) {
  return {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "10px 12px",
    fontSize: 14,
    color: theme.ink,
    background: theme.panelSolid,
    border: `0.5px solid ${theme.border}`,
    borderRadius: 10,
    outline: "none",
    fontFamily: FONT_SANS,
  };
}
