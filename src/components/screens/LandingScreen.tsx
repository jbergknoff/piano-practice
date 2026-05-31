import { useState } from "preact/hooks";
import type { useBluetooth } from "../../hooks/use-bluetooth";
import type { ThemeTokens } from "../../theme";
import {
  blurFilter,
  FONT_MONO,
  FONT_SANS,
  hexA,
  serifTitle,
} from "../../theme";
import { ConnectionBadge } from "../ConnectionBadge";
import { HelpBadge } from "../HelpBadge";
import { OpenFileIcon } from "../icons";

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
        fontFamily: FONT_SANS,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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

      {/* Connection badge + help — bottom right, matching practice screen */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 22,
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {!connected && <HelpBadge theme={theme} accent={accent} />}
        <ConnectionBadge
          theme={theme}
          accent={accent}
          bluetooth={bluetooth}
          compact={true}
        />
      </div>

      {/* Centered drop zone */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 480,
          padding: "0 24px",
          boxSizing: "border-box",
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
            width: "100%",
            height: 320,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            padding: "32px 32px 56px",
            boxSizing: "border-box",
            background: hovering ? hexA(accent, 0.08) : theme.panel,
            border: `1.5px dashed ${hovering ? accent : hexA(theme.ink, 0.18)}`,
            borderRadius: 24,
            ...blurFilter("blur(20px) saturate(160%)"),
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
            accept=".mid,.midi,audio/midi,.musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml"
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
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: hexA(accent, 0.12),
              color: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <OpenFileIcon size={26} />
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ ...serifTitle(theme, 28), lineHeight: 1.2 }}>
              Drop a piece here
            </div>
            <div style={{ fontSize: 13, color: theme.inkSoft, marginTop: 6 }}>
              or click to browse
            </div>
          </div>

          {fileError && (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: theme.error,
                textAlign: "center",
              }}
            >
              {fileError}
            </p>
          )}

          <div
            style={{
              display: "flex",
              gap: 5,
              alignItems: "center",
              position: "absolute",
              bottom: 18,
            }}
          >
            {[".mid", ".midi", ".musicxml", ".xml", ".mxl"].map((ext) => (
              <span
                key={ext}
                style={{
                  fontFamily: FONT_MONO,
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
