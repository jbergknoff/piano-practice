import { useState } from "preact/hooks";
import type { DebugBeatEvent } from "../use-wait-mode";
import type { ThemeTokens } from "../theme";
import { hexA } from "../theme";
import { BluetoothIcon } from "./icons";
import { DebugLogTab } from "./DebugLogTab";

const IS_MOBILE_BRAVE =
  "brave" in navigator && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

type Tab = "about" | "bluetooth" | "debugging";

const emptyLog = (): DebugBeatEvent[] => [];

export function HelpBadge({
  theme,
  accent,
  getDebugLog = emptyLog,
}: {
  theme: ThemeTokens;
  accent: string;
  getDebugLog?: () => DebugBeatEvent[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("about");

  return (
    <>
      <button
        type="button"
        aria-label="Help"
        onClick={() => setOpen(true)}
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: `1px solid ${theme.border}`,
          background: theme.panel,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: theme.inkSoft,
          fontSize: 12,
          fontFamily: "'Geist', sans-serif",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          outline: "none",
          flexShrink: 0,
        }}
      >
        ?
      </button>

      {open && (
        <>
          {/* Backdrop */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop only closes */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 199,
              background: "rgba(0,0,0,0.3)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
            }}
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 200,
              background: theme.panelSolid,
              border: `0.5px solid ${theme.border}`,
              borderRadius: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              width: "min(400px, calc(100vw - 40px))",
              maxHeight: "calc(100vh - 80px)",
              display: "flex",
              flexDirection: "column",
              fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 0",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontStyle: "italic",
                  fontSize: 22,
                  color: theme.ink,
                }}
              >
                Help
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: theme.inkSoft,
                  cursor: "pointer",
                  fontSize: 18,
                  padding: 4,
                  outline: "none",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {/* Tab bar */}
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: "14px 24px 0",
                flexShrink: 0,
              }}
            >
              {(["about", "bluetooth", "debugging"] as Tab[]).map((t) => {
                const active = tab === t;
                const labels: Record<Tab, string> = {
                  about: "About",
                  bluetooth: "Bluetooth",
                  debugging: "Debugging",
                };
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: 20,
                      border: active ? "none" : `0.5px solid ${theme.border}`,
                      background: active ? accent : "transparent",
                      color: active ? "#FFF7E5" : theme.inkSoft,
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                      outline: "none",
                      fontFamily: "'Geist', sans-serif",
                      transition: "background 0.15s, color 0.15s",
                    }}
                  >
                    {labels[t]}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div
              style={{
                padding: "18px 24px 24px",
                overflowY: "auto",
                flex: 1,
              }}
            >
              {tab === "about" ? (
                <AboutTab theme={theme} accent={accent} />
              ) : tab === "bluetooth" ? (
                <BluetoothTab theme={theme} accent={accent} />
              ) : (
                <DebugLogTab
                  theme={theme}
                  accent={accent}
                  getDebugLog={getDebugLog}
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function AboutTab({
  theme,
  accent,
}: {
  theme: ThemeTokens;
  accent: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: theme.inkSoft,
          lineHeight: 1.55,
        }}
      >
        This is an app for practicing piano pieces. It's designed to be used on
        a phone, connected to a digital piano (with MIDI output) over Bluetooth.{" "}
        <a
          href="https://github.com/jbergknoff/piano-practice"
          target="_blank"
          rel="noreferrer"
          style={{ color: accent, textDecoration: "none" }}
        >
          Source on GitHub ↗
        </a>
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: theme.inkSoft,
          }}
        >
          Modes
        </span>

        {[
          {
            name: "Wait",
            desc: "Only advances through the music when you've played the correct notes for the beat.",
          },
          {
            name: "Playalong",
            desc: "Play along with the music at the chosen tempo. Keeps moving whether or not you hit the right notes.",
          },
          {
            name: "Listen",
            desc: "Simply plays the music aloud. Use it to hear a section before practicing it.",
          },
        ].map(({ name, desc }) => (
          <div
            key={name}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: `0.5px solid ${theme.border}`,
              background: hexA(theme.ink, 0.03),
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>
              {name}
            </span>
            <span
              style={{ fontSize: 12, color: theme.inkSoft, lineHeight: 1.5 }}
            >
              {desc}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BluetoothTab({
  theme,
  accent,
}: {
  theme: ThemeTokens;
  accent: string;
}) {
  const steps: { key: string; content: preact.ComponentChildren }[] = [
    {
      key: "pair",
      content:
        "Enable Bluetooth MIDI pairing on your piano (check its manual).",
    },
    {
      key: "connect",
      content: (
        <span>
          Tap the{" "}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "1px 6px",
              borderRadius: 6,
              background: hexA(theme.ink, 0.08),
              verticalAlign: "middle",
            }}
          >
            <BluetoothIcon size={10} />
          </span>{" "}
          button in the bottom right to connect your piano.
        </span>
      ),
    },
    {
      key: "pick",
      content: "Select your piano from the browser's device picker.",
    },
    {
      key: "play",
      content: "Once connected, play notes — the score will respond.",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {steps.map(({ key, content }, i) => (
          <div
            key={key}
            style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: hexA(accent, 0.14),
                color: accent,
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {i + 1}
            </span>
            <span
              style={{ fontSize: 12, color: theme.inkSoft, lineHeight: 1.45 }}
            >
              {content}
            </span>
          </div>
        ))}
      </div>

      {IS_MOBILE_BRAVE && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: `0.5px solid ${theme.border}`,
            background: hexA(theme.ink, 0.03),
            fontSize: 11,
            color: theme.inkSoft,
            lineHeight: 1.5,
          }}
        >
          <span style={{ fontWeight: 600 }}>
            Enable Web Bluetooth in Brave (one-time):
          </span>{" "}
          open{" "}
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10 }}>
            brave://flags
          </span>{" "}
          in Brave, search for{" "}
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10 }}>
            enable-experimental-web-platform-features
          </span>
          , set it to <span style={{ fontWeight: 600 }}>Enabled</span>, then tap{" "}
          <span style={{ fontWeight: 600 }}>Relaunch</span> at the bottom.
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: theme.inkFaint,
          lineHeight: 1.4,
          paddingTop: 2,
        }}
      >
        Requires a Chromium-based browser.{" "}
        <a
          href="https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md"
          target="_blank"
          rel="noreferrer"
          style={{ color: accent, textDecoration: "none" }}
        >
          Implementation status ↗
        </a>
      </div>
    </div>
  );
}
