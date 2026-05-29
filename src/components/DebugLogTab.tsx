import { useState } from "preact/hooks";
import type { DebugBeatEvent } from "../debug-log";
import type { ThemeTokens } from "../theme";
import { FONT_MONO, FONT_SANS, hexA, miniButtonStyle } from "../theme";
import { TrashIcon } from "./icons";

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

function formatDebugLog(events: DebugBeatEvent[]): string {
  if (events.length === 0) {
    return "(no events yet — play some notes in Wait or Playalong mode to populate this log)";
  }
  const lines: string[] = [
    "=== Piano Practice Debug Log ===",
    `Version: ${GIT_COMMIT}`,
    `Captured: ${new Date().toISOString()}`,
    `Events (oldest → newest, up to ${events.length}):`,
    "",
  ];
  for (const e of events) {
    const ts = new Date(e.t).toISOString();
    const nn = `${noteName(e.note)}(${e.note})`;
    const heldStr = e.held.map((n) => `${noteName(n)}(${n})`).join(",");
    const loc =
      e.measure >= 0 ? `measure=${e.measure} beat=${e.beat.toFixed(2)}` : "—";

    let modeFields: string;
    if (e.mode === "wait") {
      const expStr = e.expected.map((n) => `${noteName(n)}(${n})`).join(",");
      modeFields =
        `  waitPoint=${e.pointIndex} ${loc}` +
        `  expected=[${expStr}]  held=[${heldStr}]` +
        `  msSinceAdvance=${e.msSinceAdvance}`;
    } else {
      modeFields = `  ${loc}  held=[${heldStr}]`;
    }

    lines.push(
      `${ts}  [${e.mode}]  ${e.kind.toUpperCase().padEnd(3)}  ${nn.padEnd(10)}${modeFields}  → ${e.outcome.toUpperCase()}`,
    );
  }
  return lines.join("\n");
}

export function DebugLogTab({
  theme,
  accent,
  getDebugLog,
  clearDebugLog,
}: {
  theme: ThemeTokens;
  accent: string;
  getDebugLog: () => DebugBeatEvent[];
  clearDebugLog: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const log = formatDebugLog(getDebugLog());
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

  function handleClear() {
    clearDebugLog();
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
        Rolling log of the last {50} note events in Wait mode. Use this to
        report matching bugs — capture a snapshot right after a mis-match
        occurs.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
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
          aria-label="Clear log"
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
