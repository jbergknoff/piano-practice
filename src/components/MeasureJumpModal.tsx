import { useEffect, useRef, useState } from "preact/hooks";
import type { ThemeTokens } from "../theme";
import {
  dimBackdrop,
  FONT_SANS,
  glassPanel,
  modalActionButtonStyle,
  serifTitle,
} from "../theme";

interface MeasureJumpModalProps {
  currentMeasure: number;
  totalMeasures: number;
  onConfirm: (measureNumber: number) => void;
  onCancel: () => void;
  theme: ThemeTokens;
  accent: string;
}

export function MeasureJumpModal({
  currentMeasure,
  totalMeasures,
  onConfirm,
  onCancel,
  theme,
  accent,
}: MeasureJumpModalProps) {
  const [draft, setDraft] = useState(String(currentMeasure));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const parsedMeasure = Number(draft);
  const isValid =
    Number.isInteger(parsedMeasure) &&
    parsedMeasure >= 1 &&
    parsedMeasure <= totalMeasures &&
    draft.trim() !== "";

  function handleConfirm() {
    if (isValid) {
      onConfirm(parsedMeasure);
    }
  }

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
          width: 260,
          maxWidth: "calc(100vw - 48px)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ ...serifTitle(theme, 22), marginBottom: 4 }}>
          Jump to measure
        </div>
        <div style={{ fontSize: 11, color: theme.inkSoft, marginBottom: 16 }}>
          1–{totalMeasures}
        </div>
        <input
          ref={inputRef}
          type="number"
          min={1}
          max={totalMeasures}
          step={1}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            const key = (e as unknown as KeyboardEvent).key;
            if (key === "Enter") {
              handleConfirm();
            } else if (key === "Escape") {
              onCancel();
            }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            fontSize: 22,
            textAlign: "center",
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
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={modalActionButtonStyle(theme, "ghost")}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isValid}
            style={modalActionButtonStyle(theme, "accent", accent, isValid)}
          >
            Go
          </button>
        </div>
      </div>
    </>
  );
}
