import { useState } from "preact/hooks";
import type { ThemeTokens } from "../theme";
import { hexA } from "../theme";
import type { useBluetooth } from "../useBluetooth";
import { BluetoothHelpBadge } from "./BluetoothHelpBadge";
import { ConnectionBadge } from "./ConnectionBadge";
import { UploadIcon } from "./icons";

interface LandingScreenProps {
  theme: ThemeTokens;
  accent: string;
  fileError: string | null;
  bluetooth: ReturnType<typeof useBluetooth>;
  onFile: (e: Event) => void;
  onDrop: (e: DragEvent) => void;
}

export function LandingScreen({
  theme,
  accent,
  fileError,
  bluetooth,
  onFile,
  onDrop,
}: LandingScreenProps) {
  const [hovering, setHovering] = useState(false);
  const connected = bluetooth.status === "connected";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        background: `radial-gradient(120% 80% at 50% 0%, ${theme.bg} 0%, ${theme.bgDeep} 100%)`,
        color: theme.ink,
        fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        alignItems: "center",
        padding: "0 64px",
        gap: 48,
      }}
    >
      {/* Paper texture */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          background:
            "radial-gradient(circle at 30% 20%, rgba(0,0,0,0.04) 0px, transparent 60%), radial-gradient(circle at 70% 80%, rgba(0,0,0,0.04) 0px, transparent 60%)",
        }}
      />

      {/* Connection badge + help — top right */}
      <div
        style={{
          position: "absolute",
          top: 22,
          right: 24,
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {!connected && <BluetoothHelpBadge theme={theme} accent={accent} />}
        <ConnectionBadge theme={theme} bluetooth={bluetooth} compact={false} />
      </div>

      {/* LEFT column */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <div
          style={{
            fontSize: 10,
            color: theme.inkSoft,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          ♪ Piano Practice
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: "'Instrument Serif', serif",
            fontStyle: "italic",
            fontSize: 56,
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            fontWeight: 400,
            color: theme.ink,
          }}
        >
          Piano
          <br />
          practice.
        </h1>
        <p
          style={{
            marginTop: 18,
            fontSize: 13,
            lineHeight: 1.5,
            color: theme.inkSoft,
            maxWidth: 320,
          }}
        >
          Open a piece and play along — the score advances when you hit the
          right notes.
        </p>

        {fileError && (
          <p style={{ marginTop: 12, fontSize: 12, color: theme.error }}>
            {fileError}
          </p>
        )}
      </div>

      {/* RIGHT column — drop zone */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setHovering(true);
          }}
          onDragLeave={() => setHovering(false)}
          onDrop={(e) => {
            setHovering(false);
            onDrop(e as unknown as DragEvent);
          }}
          style={{
            width: 300,
            height: 230,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: "22px 22px 44px",
            background: hovering ? hexA(accent, 0.08) : theme.panel,
            border: `1.5px dashed ${hovering ? accent : hexA(theme.ink, 0.18)}`,
            borderRadius: 18,
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            cursor: "pointer",
            position: "relative",
            boxShadow: hovering
              ? `0 8px 30px ${hexA(accent, 0.18)}`
              : "0 4px 14px rgba(0,0,0,0.06)",
            transition: "all 0.18s ease",
          }}
        >
          <input
            type="file"
            accept=".mid,.midi,audio/midi"
            onChange={onFile}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
            }}
          />

          {/* Upload icon */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: hexA(accent, 0.12),
              color: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <UploadIcon size={20} />
          </div>

          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "'Instrument Serif', serif",
                fontStyle: "italic",
                fontSize: 20,
                color: theme.ink,
                lineHeight: 1.2,
              }}
            >
              Drop a piece here
            </div>
            <div style={{ fontSize: 11, color: theme.inkSoft, marginTop: 4 }}>
              or click to browse
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 5,
              alignItems: "center",
              position: "absolute",
              bottom: 14,
            }}
          >
            {[".mid", ".midi"].map((ext) => (
              <span
                key={ext}
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 9,
                  letterSpacing: "0.04em",
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: theme.border,
                  color: theme.inkSoft,
                }}
              >
                {ext}
              </span>
            ))}
          </div>
        </label>
      </div>
    </div>
  );
}
