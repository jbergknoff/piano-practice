import { useState } from "preact/hooks";
import type { ThemeTokens } from "../theme";
import { hexA } from "../theme";

const IS_MOBILE_BRAVE =
  "brave" in navigator && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

export function BluetoothHelpBadge({
  theme,
  accent,
}: {
  theme: ThemeTokens;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Bluetooth setup help"
        onClick={() => setOpen((v) => !v)}
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
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop only closes, not primary interaction
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99 }}
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            zIndex: 100,
            width: 260,
            maxHeight: "70vh",
            overflowY: "auto",
            background: theme.panelSolid,
            border: `1px solid ${theme.border}`,
            borderRadius: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
            padding: "16px 18px 18px",
            fontFamily: "'Geist', sans-serif",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: theme.ink,
              marginBottom: 12,
              letterSpacing: "0.01em",
            }}
          >
            Connecting a Bluetooth piano
          </div>
          {[
            {
              n: 1,
              text: "Enable Bluetooth MIDI pairing on your piano (check its manual).",
            },
            {
              n: 2,
              text: 'Click "Connect Bluetooth" in the top-right corner.',
            },
            {
              n: 3,
              text: "Select your piano from the browser's device picker.",
            },
            {
              n: 4,
              text: "Once connected, play notes — the score will wait for you.",
            },
          ].map(({ n, text }) => (
            <div
              key={n}
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 9,
                alignItems: "flex-start",
              }}
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
                {n}
              </span>
              <span
                style={{ fontSize: 12, color: theme.inkSoft, lineHeight: 1.45 }}
              >
                {text}
              </span>
            </div>
          ))}
          {IS_MOBILE_BRAVE && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: `1px solid ${theme.border}`,
                fontSize: 11,
                color: theme.inkSoft,
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontWeight: 600 }}>
                Enable Web Bluetooth in Brave (one-time):
              </span>{" "}
              open{" "}
              <span
                style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10 }}
              >
                brave://flags
              </span>{" "}
              in Brave, search for{" "}
              <span
                style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10 }}
              >
                enable-experimental-web-platform-features
              </span>
              , set it to <span style={{ fontWeight: 600 }}>Enabled</span>, then
              tap <span style={{ fontWeight: 600 }}>Relaunch</span> at the
              bottom.
            </div>
          )}
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: `1px solid ${theme.border}`,
              fontSize: 11,
              color: theme.inkFaint,
              lineHeight: 1.4,
            }}
          >
            Requires Chrome or Edge on desktop. Web Bluetooth is not available
            in Safari or Firefox.
          </div>
        </div>
      )}
    </div>
  );
}
