import { useState } from "preact/hooks";
import { midiNoteName } from "../../lib/midi/ble-midi";
import {
  CENTS_TOLERANCE,
  MIN_PROMINENCE_DB,
  ON_FRAMES,
  THRESHOLD_DB,
} from "../hooks/use-microphone";
import type { MicrophoneFrameDiagnostic } from "../microphone-diagnostics";
import type { ThemeTokens } from "../theme";
import { FONT_MONO, FONT_SANS, hexA, miniButtonStyle } from "../theme";
import { TrashIcon } from "./icons";

function noteLabel(midi: number): string {
  return `${midiNoteName(midi)}(${midi})`;
}

function formatDiagnostics(frames: MicrophoneFrameDiagnostic[]): string {
  if (frames.length === 0) {
    return "(no frames yet — enable the microphone and play a note, then reopen this tab)";
  }
  const lines: string[] = [
    "=== Piano Practice Microphone Diagnostics ===",
    `Version: ${GIT_COMMIT}`,
    `Captured: ${new Date().toISOString()}`,
    `Gates: prominence>=${MIN_PROMINENCE_DB}dB  |cents|<=${CENTS_TOLERANCE}  threshold>=${THRESHOLD_DB}dB  onFrames=${ON_FRAMES}`,
    "Per peak: freq  magnitude  +prominence  note(cents)  ✓/✗accepted",
    `Frames (oldest → newest, ${frames.length}):`,
    "",
  ];
  for (const frame of frames) {
    const ts = new Date(frame.t).toISOString().slice(11, 23);
    const detectedStr =
      frame.detected.length > 0 ? frame.detected.map(noteLabel).join(",") : "—";
    const onStr = frame.on.length > 0 ? frame.on.map(noteLabel).join(",") : "—";
    lines.push(
      `${ts}  floor=${frame.noiseFloorDb.toFixed(1)}dB  detected=[${detectedStr}]  on=[${onStr}]`,
    );
    for (const peak of frame.peaks) {
      const mark = peak.accepted ? "✓" : "✗";
      const freqStr = `${peak.frequency.toFixed(1).padStart(7)}Hz`;
      const magStr = `${peak.magnitudeDb.toFixed(1).padStart(6)}dB`;
      const promStr = `+${peak.prominenceDb.toFixed(1).padStart(5)}dB`;
      const noteStr = noteLabel(peak.note).padEnd(8);
      const centsStr = `${peak.centsOff >= 0 ? "+" : ""}${peak.centsOff.toFixed(0)}c`;
      lines.push(
        `    ${freqStr}  ${magStr}  ${promStr}  ${noteStr} ${centsStr}  ${mark}`,
      );
    }
  }
  return lines.join("\n");
}

export function MicrophoneDebugTab({
  theme,
  accent,
  getDiagnostics,
  clearDiagnostics,
}: {
  theme: ThemeTokens;
  accent: string;
  getDiagnostics: () => MicrophoneFrameDiagnostic[];
  clearDiagnostics: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const log = formatDiagnostics(getDiagnostics());
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
  }

  function handleClear() {
    clearDiagnostics();
    setRefreshKey((key) => key + 1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: theme.inkSoft,
          lineHeight: 1.5,
        }}
      >
        Rolling spectrum diagnostics for tuning microphone detection. Enable the
        mic, play a note for a second or two, then tap Refresh and copy. Each
        peak shows its prominence above the noise floor and its tuning offset —
        compare against the gates to see why a note did or didn't register.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={handleRefresh}
          style={{
            padding: "5px 14px",
            borderRadius: 20,
            border: `0.5px solid ${theme.border}`,
            background: "transparent",
            color: theme.inkSoft,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            outline: "none",
            fontFamily: FONT_SANS,
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={copyToClipboard}
          style={{
            padding: "5px 14px",
            borderRadius: 20,
            border: "none",
            background: accent,
            color: "#FFF7E5",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            outline: "none",
            fontFamily: FONT_SANS,
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          aria-label="Clear diagnostics"
          onClick={handleClear}
          style={miniButtonStyle(theme)}
        >
          <TrashIcon size={14} />
        </button>
      </div>

      <pre
        key={refreshKey}
        style={{
          margin: 0,
          padding: "10px 12px",
          borderRadius: 10,
          border: `0.5px solid ${theme.border}`,
          background: hexA(theme.ink, 0.03),
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: theme.inkSoft,
          lineHeight: 1.6,
          overflowX: "auto",
          whiteSpace: "pre",
          maxHeight: 320,
          overflowY: "auto",
        }}
      >
        {log}
      </pre>
    </div>
  );
}
