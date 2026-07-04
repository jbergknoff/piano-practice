import { useState } from "preact/hooks";
import type { LibrarySummary } from "../../hooks/use-file-history";
import type { LibraryEntry } from "../../hooks/use-file-library";
import type { PianoController } from "../../hooks/use-piano";
import { prettyTitle } from "../../pretty-title";
import type { ThemeTokens } from "../../theme";
import {
  blurFilter,
  FONT_MONO,
  FONT_SANS,
  glassPanel,
  hexA,
  miniButtonStyle,
  serifTitle,
} from "../../theme";
import { ConnectionBadge } from "../ConnectionBadge";
import { formatDate, ScoreChip } from "../ResultModal";
import { HelpBadge } from "../HelpBadge";
import { OpenFileIcon, TrashIcon } from "../icons";

type LibraryListEntry = LibraryEntry & LibrarySummary;

interface LandingScreenProps {
  theme: ThemeTokens;
  accent: string;
  fileError: string | null;
  piano: PianoController;
  onFile: (e: Event) => void;
  onDrop: (e: DragEvent) => void;
  entries: LibraryListEntry[];
  onSelectEntry: (entry: LibraryListEntry) => void;
  onDeleteEntry: (hash: string) => void;
}

function LibraryRow({
  theme,
  entry,
  onSelect,
  onDelete,
}: {
  theme: ThemeTokens;
  entry: LibraryListEntry;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const title = prettyTitle(entry.fileName);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 6,
        borderRadius: 10,
        border: `0.5px solid ${theme.border}`,
        background: theme.panel,
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          flex: 1,
          minWidth: 0,
          outline: "none",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: theme.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: theme.inkSoft }}>
            {entry.lastPracticedAt !== null
              ? formatDate(entry.lastPracticedAt)
              : "Not yet practiced"}
          </span>
          {entry.mode && (
            <span style={{ fontSize: 11, color: theme.inkFaint }}>
              {entry.mode}
            </span>
          )}
          {entry.bestScore !== null && (
            <span style={{ fontSize: 11 }}>
              <ScoreChip score={entry.bestScore} />
            </span>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`Remove "${title}" from your library?`)) {
            onDelete();
          }
        }}
        title="Delete"
        style={{
          ...miniButtonStyle(theme),
          alignSelf: "center",
          marginRight: 8,
        }}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

export function LandingScreen({
  theme,
  accent,
  fileError,
  piano,
  onFile,
  onDrop,
  entries,
  onSelectEntry,
  onDeleteEntry,
}: LandingScreenProps) {
  const [hovering, setHovering] = useState(false);
  const connected = piano.status === "connected";

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
          piano={piano}
          compact={true}
        />
      </div>

      {/* Centered drop zone + library */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 480,
          padding: "0 24px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxHeight: "100%",
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

        {entries.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 16,
              borderRadius: 16,
              overflowY: "auto",
              maxHeight: 260,
              ...glassPanel(theme),
            }}
          >
            <span style={serifTitle(theme, 16)}>Your pieces</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {entries.map((entry) => (
                <LibraryRow
                  key={entry.hash}
                  theme={theme}
                  entry={entry}
                  onSelect={() => onSelectEntry(entry)}
                  onDelete={() => onDeleteEntry(entry.hash)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
