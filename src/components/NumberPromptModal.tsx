import { useRef, useState } from "preact/hooks";
import type { ThemeTokens } from "../theme";
import {
  FONT_SANS,
  glassPanel,
  modalActionButtonStyle,
  serifTitle,
} from "../theme";
import { Modal } from "./Modal";

interface NumberPromptModalProps {
  title: string;
  /** Small hint under the title, e.g. the allowed range. */
  hint: string;
  initialValue: number;
  /**
   * Turns the input's text into the value to confirm, or null when it isn't
   * acceptable (which disables the confirm button and Enter).
   */
  parse: (draft: string) => number | null;
  confirmLabel: string;
  onConfirm: (value: number) => void;
  onCancel: () => void;
  theme: ThemeTokens;
  accent: string;
}

/**
 * A small modal asking for one number — the custom-tempo and jump-to-measure
 * prompts. Enter confirms (it's a <form>), Escape and the backdrop cancel.
 */
export function NumberPromptModal({
  title,
  hint,
  initialValue,
  parse,
  confirmLabel,
  onConfirm,
  onCancel,
  theme,
  accent,
}: NumberPromptModalProps) {
  const [draft, setDraft] = useState(String(initialValue));
  const inputRef = useRef<HTMLInputElement>(null);
  const value = parse(draft);
  const isValid = value !== null;

  return (
    <Modal
      label={title}
      onClose={onCancel}
      onShow={() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }}
      style={{
        ...glassPanel(theme, 24, 160),
        borderRadius: 16,
        padding: "24px 28px",
        boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
        width: 260,
        maxWidth: "calc(100vw - 48px)",
        boxSizing: "border-box",
      }}
    >
      {/* noValidate: `parse` is the validation. The browser's own would add
          nothing but a conflict — `step={1}` would make it reject a tempo
          like 120.5, which `parseBpm` accepts and rounds. */}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (value !== null) {
            onConfirm(value);
          }
        }}
      >
        <div style={{ ...serifTitle(theme, 22), marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 11, color: theme.inkSoft, marginBottom: 16 }}>
          {hint}
        </div>
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          step={1}
          value={draft}
          onInput={(event) =>
            setDraft((event.target as HTMLInputElement).value)
          }
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
            type="submit"
            disabled={!isValid}
            style={modalActionButtonStyle(theme, "accent", accent, isValid)}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Parses a tempo: any number from 20 to 300 BPM, rounded to a whole BPM. */
export function parseBpm(draft: string): number | null {
  const parsed = Number(draft);
  if (draft.trim() === "" || !Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 20 || parsed > 300) {
    return null;
  }
  return Math.round(parsed);
}

/** Parses a measure number: a whole number from 1 to `totalMeasures`. */
export function parseMeasureNumber(
  draft: string,
  totalMeasures: number,
): number | null {
  const parsed = Number(draft);
  if (draft.trim() === "" || !Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 1 || parsed > totalMeasures) {
    return null;
  }
  return parsed;
}
