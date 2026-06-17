import { useState } from "preact/hooks";
import type { DebugBeatEvent } from "../debug-log";
import type { ThemeTokens } from "../theme";
import {
  FONT_MONO,
  FONT_SANS,
  hexA,
  miniButtonStyle,
  modalActionButtonStyle,
} from "../theme";
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

type SubmitPhase = "idle" | "form" | "pending" | "success" | "error";

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
  const events = getDebugLog();
  const log = formatDebugLog(events);
  const hasEvents = events.length > 0;

  const [copied, setCopied] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [explanation, setExplanation] = useState("");

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

  function handleOpenSubmitForm() {
    setExplanation("");
    setSubmitPhase("form");
  }

  function handleCancelSubmit() {
    setSubmitPhase("idle");
  }

  async function handleSubmit() {
    setSubmitPhase("pending");
    try {
      const body = new URLSearchParams({
        "form-name": "debug-log",
        log,
        explanation,
      });
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setSubmitPhase("success");
      setTimeout(() => setSubmitPhase("idle"), 4000);
    } catch {
      setSubmitPhase("error");
    }
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

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
        {submitPhase === "idle" && (
          <button
            type="button"
            disabled={!hasEvents}
            onClick={handleOpenSubmitForm}
            style={{
              padding: "5px 14px",
              borderRadius: 20,
              border: `0.5px solid ${theme.border}`,
              background: "transparent",
              color: hasEvents ? theme.ink : theme.inkFaint,
              fontSize: 12,
              fontWeight: 600,
              cursor: hasEvents ? "pointer" : "not-allowed",
              outline: "none",
              fontFamily: FONT_SANS,
            }}
          >
            Submit
          </button>
        )}
        {submitPhase === "success" && (
          <span
            style={{
              fontSize: 12,
              color: theme.inkSoft,
              fontFamily: FONT_SANS,
            }}
          >
            Submitted — thanks!
          </span>
        )}
        {submitPhase === "error" && (
          <span
            style={{
              fontSize: 12,
              color: theme.error,
              fontFamily: FONT_SANS,
            }}
          >
            Submission failed.{" "}
            <button
              type="button"
              onClick={handleOpenSubmitForm}
              style={{
                background: "none",
                border: "none",
                color: theme.error,
                fontSize: 12,
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
                fontFamily: FONT_SANS,
              }}
            >
              Try again
            </button>
          </span>
        )}
        <button
          type="button"
          aria-label="Clear log"
          onClick={handleClear}
          style={{ ...miniButtonStyle(theme), marginLeft: "auto" }}
        >
          <TrashIcon size={14} />
        </button>
      </div>

      {(submitPhase === "form" || submitPhase === "pending") && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <textarea
            placeholder="What didn't work as expected? (optional)"
            value={explanation}
            onInput={(event) =>
              setExplanation((event.target as HTMLTextAreaElement).value)
            }
            rows={3}
            style={{
              resize: "vertical",
              padding: "8px 10px",
              borderRadius: 8,
              border: `0.5px solid ${theme.border}`,
              background: hexA(theme.ink, 0.03),
              color: theme.ink,
              fontFamily: FONT_SANS,
              fontSize: 12,
              outline: "none",
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={handleCancelSubmit}
              disabled={submitPhase === "pending"}
              style={modalActionButtonStyle(theme, "ghost")}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitPhase === "pending"}
              style={modalActionButtonStyle(
                theme,
                "accent",
                accent,
                submitPhase !== "pending",
              )}
            >
              {submitPhase === "pending" ? "Sending…" : "Send report"}
            </button>
          </div>
        </div>
      )}

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
