import { midiNoteName } from "../../lib/midi/ble-midi";
import type { useMicrophone } from "../hooks/use-microphone";
import type { ThemeTokens } from "../theme";
import { glassPanel, hexA, radius } from "../theme";
import { MicrophoneIcon } from "./icons";

// Temporary microphone control: a compact pill that triggers the browser
// mic-permission prompt and toggles acoustic note detection, plus a small live
// readout of the notes currently detected (a validation aid for the finicky
// FFT pitch detection — intentionally minimal and easy to remove later).
export function MicrophoneBadge({
  theme,
  accent,
  microphone,
}: {
  theme: ThemeTokens;
  accent: string;
  microphone: ReturnType<typeof useMicrophone>;
}) {
  const active = microphone.status === "active";
  const requesting = microphone.status === "requesting";
  const hasError = microphone.status === "error";

  const dotColor = active ? "#5E8C5A" : hasError ? "#c62828" : theme.inkFaint;

  const title = active
    ? "Listening… (click to stop)"
    : requesting
      ? "Requesting microphone…"
      : hasError
        ? (microphone.error ?? "Microphone unavailable")
        : "Enable microphone";

  function handleClick() {
    if (active) {
      microphone.disable();
      return;
    }
    void microphone.enable();
  }

  const readoutText =
    microphone.detectedNotes.length > 0
      ? microphone.detectedNotes.map(midiNoteName).join(" ")
      : "—";

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      {active && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            ...glassPanel(theme),
            borderRadius: radius.md,
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.02em",
            color: theme.inkSoft,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <span style={{ color: theme.inkFaint }}>mic:</span>{" "}
          <span style={{ color: accent }}>{readoutText}</span>
        </div>
      )}
      <button
        type="button"
        title={title}
        onClick={handleClick}
        style={
          {
            height: 38,
            ...glassPanel(theme),
            borderRadius: radius.lg,
            boxShadow: active
              ? `0 0 0 1.5px ${hexA(accent, 0.4)}, 0 2px 8px rgba(0,0,0,0.05)`
              : "0 2px 8px rgba(0,0,0,0.05)",
            display: "inline-flex",
            alignItems: "center",
            cursor: "pointer",
            color: hasError ? "#c62828" : theme.inkSoft,
            outline: "none",
            padding: "0 10px",
            gap: 6,
          } as Record<string, string | number>
        }
      >
        <MicrophoneIcon size={12} />
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: active ? `0 0 0 3px ${hexA("#5E8C5A", 0.18)}` : "none",
            flexShrink: 0,
          }}
        />
      </button>
    </div>
  );
}
