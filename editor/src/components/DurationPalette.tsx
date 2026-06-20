import type { NoteType } from "../sheet-music/index";

// The note durations the palette offers, with their length in quarter-note
// beats (the unit dom-edit / hit-test work in).
export const DURATION_OPTIONS: ReadonlyArray<{
  type: NoteType;
  label: string;
  beats: number;
}> = [
  { type: "whole", label: "Whole", beats: 4 },
  { type: "half", label: "Half", beats: 2 },
  { type: "quarter", label: "Quarter", beats: 1 },
  { type: "eighth", label: "Eighth", beats: 0.5 },
  { type: "16th", label: "16th", beats: 0.25 },
];

export function beatsForDuration(type: NoteType): number {
  return DURATION_OPTIONS.find((o) => o.type === type)?.beats ?? 1;
}

// Toolbar of duration buttons; the active one is highlighted. Self-contained
// minimal styling — the editor deliberately does not depend on the app theme.
export function DurationPalette({
  value,
  onChange,
}: {
  value: NoteType;
  onChange: (type: NoteType) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {DURATION_OPTIONS.map((option) => {
        const active = option.type === value;
        return (
          <button
            key={option.type}
            type="button"
            onClick={() => onChange(option.type)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: active ? "1px solid #1976d2" : "1px solid #ccc",
              background: active ? "#1976d2" : "#fff",
              color: active ? "#fff" : "#333",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
