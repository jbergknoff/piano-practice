import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SheetMusicDisplay } from "./SheetMusicDisplay";
import { MidiPlayer } from "./midi-player";
import {
  type MidiConversionResult,
  type TrackInfo,
  getMidiTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
import {
  ACCENT_COLORS,
  THEMES,
  type ThemeName,
  type ThemeTokens,
  cornerBtnStyle,
  hexA,
  miniBtnStyle,
} from "./theme";
import { useWaitMode } from "./use-wait-mode";
import { useBluetooth } from "./useBluetooth";

// ── Icons ────────────────────────────────────────────────────────────────────

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}
function StopIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  );
}
function RestartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12a8 8 0 1 0 2.34-5.66" />
      <path d="M4 4v4h4" />
    </svg>
  );
}
function LoopIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M17 4l4 4-4 4" />
      <path d="M3 12V10a4 4 0 014-4h14" />
      <path d="M7 20l-4-4 4-4" />
      <path d="M21 12v2a4 4 0 01-4 4H3" />
    </svg>
  );
}
function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
      <path
        d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.08a1.7 1.7 0 00-1.11-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 005 15.18a1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.08A1.7 1.7 0 005 9.07a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.01A1.7 1.7 0 0010 3.18V3a2 2 0 114 0v.08a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.01a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.08a1.7 1.7 0 00-1.55 1z"
        stroke="currentColor"
        stroke-width="1.4"
      />
    </svg>
  );
}
function MicIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0014 0M12 18v3"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  );
}
function BluetoothIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 7l10 10-5 4V3l5 4L7 17"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
function MinusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="2" rx="1" fill="currentColor" />
      <rect x="11" y="5" width="2" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function prettyTitle(filename: string): string {
  return filename.replace(/\.(mid|midi)$/i, "").replace(/[-_]/g, " ");
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  // File / MIDI state
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Transport state
  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [measureRange, setMeasureRange] = useState<{
    from: number;
    to: number;
  } | null>(null);

  // UI state
  const [screen, setScreen] = useState<"landing" | "practice">("landing");
  const [themeName, setThemeName] = useState<ThemeName>("cream");
  const accent = ACCENT_COLORS[0];
  const [showLoop, setShowLoop] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Settings drawer state
  const [hands, setHands] = useState<"Left" | "Both" | "Right">("Both");
  const [countIn, setCountIn] = useState<0 | 1 | 2>(0);
  const [onMiss, setOnMiss] = useState<"wait" | "skip">("wait");

  const theme = THEMES[themeName];

  // Player + wait mode
  const playerRef = useRef<MidiPlayer | null>(null);
  const measureRangeRef = useRef(measureRange);
  useEffect(() => {
    measureRangeRef.current = measureRange;
  }, [measureRange]);

  const musicxml = useMemo<MidiConversionResult | null>(() => {
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  const waitMode = useWaitMode(musicxml, measureRange);
  const bluetooth = useBluetooth(waitMode.onNoteEvent);

  // Rebuild player when conversion result changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: bpm/measureRange go through player methods
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setIsPlaying(false);
    setCurrentBeat(0);

    if (musicxml && musicxml.totalBeats > 0) {
      const player = new MidiPlayer(musicxml.notes, musicxml.totalBeats, bpm);
      const range = measureRangeRef.current;
      if (range) {
        player.loopRange = {
          startBeat: (range.from - 1) * musicxml.timeSigNum,
          endBeat: range.to * musicxml.timeSigNum,
        };
      }
      player.onPositionUpdate = (beat) => {
        if (!waitMode.activeRef.current) {
          setCurrentBeat(beat);
        }
      };
      player.onEnd = () => {
        setIsPlaying(false);
        setCurrentBeat(0);
      };
      playerRef.current = player;
    }

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [musicxml]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: waitMode.activeRef is a ref
  useEffect(() => {
    const player = playerRef.current;
    if (!musicxml) {
      return;
    }
    const { timeSigNum } = musicxml;
    if (measureRange) {
      const startBeat = (measureRange.from - 1) * timeSigNum;
      const endBeat = measureRange.to * timeSigNum;
      if (player) {
        player.loopRange = { startBeat, endBeat };
        player.seek(startBeat);
      }
      if (!waitMode.activeRef.current) {
        setCurrentBeat(startBeat);
      }
    } else if (player) {
      player.loopRange = null;
    }
  }, [measureRange, musicxml]);

  async function handlePlayPause() {
    if (waitMode.active) {
      return;
    }
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      await player.play();
      setIsPlaying(true);
    }
  }

  function handleStop() {
    if (waitMode.active) {
      waitMode.rewind();
      return;
    }
    playerRef.current?.stop();
    setIsPlaying(false);
    setCurrentBeat(0);
  }

  function handleRestart() {
    playerRef.current?.stop();
    setIsPlaying(false);
    setCurrentBeat(0);
  }

  function handleBpmChange(newBpm: number) {
    setBpm(newBpm);
    playerRef.current?.setBpm(newBpm);
  }

  function handleToggleWaitMode() {
    if (!waitMode.active) {
      playerRef.current?.pause();
      setIsPlaying(false);
    }
    waitMode.toggle(currentBeat);
  }

  function parseMidiFile(file: File) {
    setFileName(file.name);
    setFileError(null);
    setMidiData(null);
    setTracks([]);
    setSelectedTracks([]);
    setIsPlaying(false);
    setCurrentBeat(0);
    setMeasureRange(null);
    setShowLoop(false);

    file.arrayBuffer().then((buffer) => {
      try {
        const parsed = parseMidi(new Uint8Array(buffer));
        const trackList = getMidiTracks(parsed);
        setMidiData(parsed);
        setTracks(trackList);
        setSelectedTracks(trackList.map((t) => t.index));
        setBpm(getMidiTempo(parsed));
        setScreen("practice");
      } catch (err) {
        setFileError(String(err));
      }
    });
  }

  function handleFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      parseMidiFile(file);
    }
  }

  function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      parseMidiFile(file);
    }
  }

  // Note colors
  const noteColors = useMemo(() => {
    if (waitMode.active) {
      return waitMode.noteColors;
    }
    if (!musicxml || currentBeat === 0) {
      return {};
    }
    const colors: Record<string, string> = {};
    for (const note of musicxml.notes) {
      if (
        note.startBeat <= currentBeat &&
        currentBeat < note.startBeat + note.durationBeats
      ) {
        colors[
          `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`
        ] = accent;
      }
    }
    return colors;
  }, [waitMode.active, waitMode.noteColors, musicxml, currentBeat, accent]);

  const playbackBeat =
    waitMode.cursorBeat ?? (currentBeat > 0 ? currentBeat : undefined);

  const totalMeasures =
    musicxml && musicxml.totalBeats > 0
      ? Math.ceil(musicxml.totalBeats / musicxml.timeSigNum)
      : 0;
  const currentMeasure =
    musicxml && musicxml.totalBeats > 0
      ? Math.min(
          totalMeasures,
          Math.floor((playbackBeat ?? 0) / musicxml.timeSigNum) + 1,
        )
      : 1;

  // Piece metadata from file name
  const pieceTitle = fileName ? prettyTitle(fileName) : "Untitled";

  if (screen === "landing") {
    return (
      <LandingScreen
        theme={theme}
        accent={accent}
        fileError={fileError}
        bluetooth={bluetooth}
        onFile={handleFileInput}
        onDrop={handleFileDrop}
      />
    );
  }

  return (
    <PracticeScreen
      theme={theme}
      themeName={themeName}
      accent={accent}
      pieceTitle={pieceTitle}
      musicxml={musicxml}
      noteColors={noteColors}
      playbackBeat={playbackBeat}
      cursorColor={waitMode.wrongNoteFlash ? theme.error : accent}
      isPlaying={isPlaying}
      bpm={bpm}
      showLoop={showLoop}
      measureRange={measureRange}
      totalMeasures={totalMeasures}
      currentMeasure={currentMeasure}
      drawerOpen={drawerOpen}
      bluetooth={bluetooth}
      waitMode={waitMode.active}
      tracks={tracks}
      selectedTracks={selectedTracks}
      // Settings
      hands={hands}
      countIn={countIn}
      onMiss={onMiss}
      onThemeChange={setThemeName}
      onPlayPause={handlePlayPause}
      onStop={handleStop}
      onRestart={handleRestart}
      onBpmChange={handleBpmChange}
      onLoopToggle={() => {
        setShowLoop((v) => {
          if (!v && musicxml) {
            setMeasureRange({ from: 1, to: Math.min(4, totalMeasures) });
          }
          if (v) {
            setMeasureRange(null);
          }
          return !v;
        });
      }}
      onMeasureRangeChange={setMeasureRange}
      onDrawerOpen={() => setDrawerOpen(true)}
      onDrawerClose={() => setDrawerOpen(false)}
      onToggleWaitMode={handleToggleWaitMode}
      onTrackToggle={(idx) =>
        setSelectedTracks((prev) =>
          prev.includes(idx)
            ? prev.filter((i) => i !== idx)
            : [...prev, idx].sort((a, b) => a - b),
        )
      }
      onHandsChange={setHands}
      onCountInChange={setCountIn}
      onOnMissChange={setOnMiss}
      onGoToLanding={() => setScreen("landing")}
    />
  );
}

// ── Landing Screen ────────────────────────────────────────────────────────────

interface LandingScreenProps {
  theme: ThemeTokens;
  accent: string;
  fileError: string | null;
  bluetooth: ReturnType<typeof useBluetooth>;
  onFile: (e: Event) => void;
  onDrop: (e: DragEvent) => void;
}

function LandingScreen({
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

      {/* Decorative staff — top right */}
      <svg
        style={{
          position: "absolute",
          right: -40,
          top: 30,
          opacity: 0.18,
          pointerEvents: "none",
        }}
        width="380"
        height="60"
        viewBox="0 0 380 60"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1="0"
            x2="380"
            y1={i * 10 + 5}
            y2={i * 10 + 5}
            stroke={theme.ink}
            stroke-width="0.6"
          />
        ))}
        <text
          x="6"
          y="46"
          font-family="'Noto Music', 'Bravura', serif"
          font-size="48"
          fill={theme.ink}
        >
          𝄞
        </text>
      </svg>

      {/* Decorative staff — bottom left */}
      <svg
        style={{
          position: "absolute",
          left: -40,
          bottom: 30,
          opacity: 0.18,
          pointerEvents: "none",
        }}
        width="380"
        height="60"
        viewBox="0 0 380 60"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1="0"
            x2="380"
            y1={i * 10 + 5}
            y2={i * 10 + 5}
            stroke={theme.ink}
            stroke-width="0.6"
          />
        ))}
      </svg>

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
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 16V4M12 4l-5 5M12 4l5 5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M4 18v2a1 1 0 001 1h14a1 1 0 001-1v-2"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
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

// ── Practice Screen ───────────────────────────────────────────────────────────

interface PracticeScreenProps {
  theme: ThemeTokens;
  themeName: ThemeName;
  accent: string;
  pieceTitle: string;
  musicxml: MidiConversionResult | null;
  noteColors: Record<string, string>;
  playbackBeat: number | undefined;
  cursorColor: string;
  isPlaying: boolean;
  bpm: number;
  showLoop: boolean;
  measureRange: { from: number; to: number } | null;
  totalMeasures: number;
  currentMeasure: number;
  drawerOpen: boolean;
  bluetooth: ReturnType<typeof useBluetooth>;
  waitMode: boolean;
  tracks: TrackInfo[];
  selectedTracks: number[];
  hands: "Left" | "Both" | "Right";
  countIn: 0 | 1 | 2;
  onMiss: "wait" | "skip";
  onThemeChange: (t: ThemeName) => void;
  onPlayPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  onBpmChange: (bpm: number) => void;
  onLoopToggle: () => void;
  onMeasureRangeChange: (r: { from: number; to: number } | null) => void;
  onDrawerOpen: () => void;
  onDrawerClose: () => void;
  onToggleWaitMode: () => void;
  onTrackToggle: (idx: number) => void;
  onHandsChange: (h: "Left" | "Both" | "Right") => void;
  onCountInChange: (c: 0 | 1 | 2) => void;
  onOnMissChange: (m: "wait" | "skip") => void;
  onGoToLanding: () => void;
}

function PracticeScreen({
  theme,
  themeName,
  accent,
  pieceTitle,
  musicxml,
  noteColors,
  playbackBeat,
  cursorColor,
  isPlaying,
  bpm,
  showLoop,
  measureRange,
  totalMeasures,
  currentMeasure,
  drawerOpen,
  bluetooth,
  waitMode,
  tracks,
  selectedTracks,
  hands,
  countIn,
  onMiss,
  onThemeChange,
  onPlayPause,
  onStop,
  onRestart,
  onBpmChange,
  onLoopToggle,
  onMeasureRangeChange,
  onDrawerOpen,
  onDrawerClose,
  onToggleWaitMode,
  onTrackToggle,
  onHandsChange,
  onCountInChange,
  onOnMissChange,
  onGoToLanding,
}: PracticeScreenProps) {
  const progress = totalMeasures > 0 ? (currentMeasure - 1) / totalMeasures : 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `radial-gradient(120% 80% at 50% 0%, ${theme.bg} 0%, ${theme.bgDeep} 100%)`,
        color: theme.ink,
        fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
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

      {/* Sheet music — full bleed */}
      {musicxml ? (
        <SheetMusicDisplay
          musicxml={musicxml.musicxml}
          noteColors={noteColors}
          playbackBeat={playbackBeat}
          cursorColor={cursorColor}
          inkColor={theme.ink}
          loopRange={showLoop ? measureRange : null}
          loopColor={hexA(accent, 0.09)}
          containerStyle={{
            position: "absolute",
            inset: 0,
            overflowX: "auto",
            overflowY: "hidden",
            padding: "56px 60px 64px",
            display: "flex",
            alignItems: "center",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.inkFaint,
            fontSize: 14,
          }}
        >
          Loading…
        </div>
      )}

      {/* Left fade */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 50,
          bottom: 56,
          width: 50,
          pointerEvents: "none",
          background: `linear-gradient(90deg, ${theme.bg} 0%, transparent 100%)`,
          zIndex: 1,
        }}
      />
      {/* Right fade */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 50,
          bottom: 56,
          width: 50,
          pointerEvents: "none",
          background: `linear-gradient(270deg, ${theme.bg} 0%, transparent 100%)`,
          zIndex: 1,
        }}
      />

      {/* TOP LEFT: piece title */}
      <div style={{ position: "absolute", top: 18, left: 22, zIndex: 2 }}>
        <button
          type="button"
          onClick={onGoToLanding}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontStyle: "italic",
              fontSize: 22,
              lineHeight: 1,
              letterSpacing: "-0.01em",
              color: theme.ink,
            }}
          >
            {pieceTitle}
          </div>
          <div
            style={{
              fontSize: 10,
              marginTop: 4,
              color: theme.inkSoft,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {musicxml ? `${musicxml.timeSigNum}/4` : ""}
            {tracks.length > 0
              ? ` · ${tracks.length} track${tracks.length !== 1 ? "s" : ""}`
              : ""}
          </div>
        </button>
      </div>

      {/* TOP RIGHT: connection badge + measure progress + gear */}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 22,
          display: "flex",
          alignItems: "center",
          gap: 14,
          zIndex: 2,
        }}
      >
        {bluetooth.status !== "connected" && (
          <BluetoothHelpBadge theme={theme} accent={accent} />
        )}
        <ConnectionBadge theme={theme} bluetooth={bluetooth} compact={true} />
        {totalMeasures > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 9,
                color: theme.inkSoft,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Measure {currentMeasure} / {totalMeasures}
            </span>
            <div
              style={{
                width: 120,
                height: 3,
                background: theme.border,
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, progress * 100)}%`,
                  height: "100%",
                  background: accent,
                  borderRadius: 2,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onDrawerOpen}
          style={cornerBtnStyle(theme) as Record<string, string | number>}
        >
          <GearIcon />
        </button>
      </div>

      {/* BOTTOM LEFT: transport controls */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 22,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 2,
        }}
      >
        <button
          type="button"
          onClick={onRestart}
          style={cornerBtnStyle(theme) as Record<string, string | number>}
          title="Restart"
        >
          <RestartIcon />
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          disabled={waitMode}
          style={{
            ...(cornerBtnStyle(theme) as Record<string, string | number>),
            width: 52,
            height: 52,
            background: accent,
            color: "#FFF7E5",
            border: "none",
            boxShadow: `0 6px 18px ${hexA(accent, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.25)`,
            opacity: waitMode ? 0.5 : 1,
          }}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
        <button
          type="button"
          onClick={onStop}
          style={cornerBtnStyle(theme) as Record<string, string | number>}
          title="Stop"
        >
          <StopIcon />
        </button>

        {/* Wait-mode toggle — styled as a chip */}
        <button
          type="button"
          onClick={onToggleWaitMode}
          style={{
            ...(cornerBtnStyle(theme) as Record<string, string | number>),
            width: "auto",
            padding: "0 12px",
            background: waitMode ? hexA(accent, 0.18) : theme.panel,
            color: waitMode ? accent : theme.inkSoft,
            borderColor: waitMode ? hexA(accent, 0.35) : theme.border,
            fontSize: 11,
            letterSpacing: "0.04em",
            gap: 6,
          }}
          title={waitMode ? "Disable wait mode" : "Enable wait mode"}
        >
          <MicIcon size={12} />
          <span>Wait</span>
        </button>
      </div>

      {/* BOTTOM RIGHT: loop toggle + BPM */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 22,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 2,
        }}
      >
        <button
          type="button"
          onClick={onLoopToggle}
          style={{
            ...(cornerBtnStyle(theme) as Record<string, string | number>),
            background: showLoop ? hexA(accent, 0.18) : theme.panel,
            color: showLoop ? accent : theme.ink,
            borderColor: showLoop ? hexA(accent, 0.35) : theme.border,
          }}
          title="Loop section"
        >
          <LoopIcon />
        </button>

        {/* BPM panel */}
        <div
          style={{
            padding: "8px 6px 8px 14px",
            background: theme.panel,
            border: `0.5px solid ${theme.border}`,
            borderRadius: 12,
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
        >
          <button
            type="button"
            onClick={() => onBpmChange(Math.max(40, bpm - 4))}
            style={miniBtnStyle(theme) as Record<string, string | number>}
          >
            <MinusIcon />
          </button>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: 52,
            }}
          >
            <span
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 18,
                fontWeight: 500,
                lineHeight: 1,
                color: theme.ink,
                letterSpacing: "-0.01em",
              }}
            >
              {bpm}
            </span>
            <span
              style={{
                fontSize: 8,
                color: theme.inkSoft,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              BPM
            </span>
          </div>
          <button
            type="button"
            onClick={() => onBpmChange(Math.min(220, bpm + 4))}
            style={miniBtnStyle(theme) as Record<string, string | number>}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      {/* Settings drawer */}
      <SettingsDrawer
        open={drawerOpen}
        onClose={onDrawerClose}
        theme={theme}
        themeName={themeName}
        accent={accent}
        bpm={bpm}
        showLoop={showLoop}
        measureRange={measureRange}
        totalMeasures={totalMeasures}
        tracks={tracks}
        selectedTracks={selectedTracks}
        hands={hands}
        countIn={countIn}
        onMiss={onMiss}
        bluetooth={bluetooth}
        onThemeChange={onThemeChange}
        onBpmChange={onBpmChange}
        onLoopToggle={onLoopToggle}
        onMeasureRangeChange={onMeasureRangeChange}
        onTrackToggle={onTrackToggle}
        onHandsChange={onHandsChange}
        onCountInChange={onCountInChange}
        onOnMissChange={onOnMissChange}
      />

      <style>{`
        @keyframes bar0 { 0%,100% { height: 4px } 50% { height: 12px } }
        @keyframes bar1 { 0%,100% { height: 6px } 50% { height: 14px } }
        @keyframes bar2 { 0%,100% { height: 5px } 50% { height: 10px } }
        @keyframes bar3 { 0%,100% { height: 8px } 50% { height: 14px } }
        @keyframes bar4 { 0%,100% { height: 3px } 50% { height: 9px } }
      `}</style>
    </div>
  );
}

// ── Bluetooth Help Badge ──────────────────────────────────────────────────────

const IS_MOBILE_BRAVE =
  "brave" in navigator && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

function BluetoothHelpBadge({
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
          width: 22,
          height: 22,
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

// ── Connection Badge ──────────────────────────────────────────────────────────

function ConnectionBadge({
  theme,
  bluetooth,
  compact,
}: {
  theme: ThemeTokens;
  bluetooth: ReturnType<typeof useBluetooth>;
  compact: boolean;
}) {
  const connected = bluetooth.status === "connected";
  const connecting = bluetooth.status === "connecting";
  const dotColor = connected ? "#5E8C5A" : theme.inkFaint;

  const pillStyle = {
    height: 28,
    background: theme.panel,
    border: `0.5px solid ${theme.border}`,
    borderRadius: 999,
    backdropFilter: "blur(20px) saturate(160%)",
    WebkitBackdropFilter: "blur(20px) saturate(160%)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    display: "inline-flex",
    alignItems: "center",
    cursor: connected ? "default" : "pointer",
    color: theme.inkSoft,
    outline: "none",
    border2: "none",
  };

  const dot = (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: dotColor,
        boxShadow: connected ? `0 0 0 3px ${hexA("#5E8C5A", 0.18)}` : "none",
        flexShrink: 0,
      }}
    />
  );

  if (compact) {
    return (
      <button
        type="button"
        title={
          connected
            ? `Connected · ${bluetooth.deviceName}`
            : connecting
              ? "Connecting…"
              : "Connect Bluetooth"
        }
        onClick={connected ? undefined : bluetooth.connect}
        style={
          { ...pillStyle, padding: "0 10px", gap: 6 } as Record<
            string,
            string | number
          >
        }
      >
        <BluetoothIcon size={11} />
        {dot}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connected ? undefined : bluetooth.connect}
      style={
        { ...pillStyle, padding: "0 12px", gap: 7, color: theme.ink } as Record<
          string,
          string | number
        >
      }
    >
      {dot}
      <BluetoothIcon size={11} />
      <span
        style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.01em" }}
      >
        {connected
          ? (bluetooth.deviceName ?? "Connected")
          : connecting
            ? "Connecting…"
            : "Connect"}
      </span>
    </button>
  );
}

// ── Settings Drawer ───────────────────────────────────────────────────────────

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeTokens;
  themeName: ThemeName;
  accent: string;
  bpm: number;
  showLoop: boolean;
  measureRange: { from: number; to: number } | null;
  totalMeasures: number;
  tracks: TrackInfo[];
  selectedTracks: number[];
  hands: "Left" | "Both" | "Right";
  countIn: 0 | 1 | 2;
  onMiss: "wait" | "skip";
  bluetooth: ReturnType<typeof useBluetooth>;
  onThemeChange: (t: ThemeName) => void;
  onBpmChange: (bpm: number) => void;
  onLoopToggle: () => void;
  onMeasureRangeChange: (r: { from: number; to: number } | null) => void;
  onTrackToggle: (idx: number) => void;
  onHandsChange: (h: "Left" | "Both" | "Right") => void;
  onCountInChange: (c: 0 | 1 | 2) => void;
  onOnMissChange: (m: "wait" | "skip") => void;
}

function SettingsDrawer({
  open,
  onClose,
  theme,
  themeName,
  accent,
  bpm,
  showLoop,
  measureRange,
  totalMeasures,
  tracks,
  selectedTracks,
  hands,
  countIn,
  onMiss,
  bluetooth,
  onThemeChange,
  onBpmChange,
  onLoopToggle,
  onMeasureRangeChange,
  onTrackToggle,
  onHandsChange,
  onCountInChange,
  onOnMissChange,
}: SettingsDrawerProps) {
  const connected = bluetooth.status === "connected";

  return (
    <>
      {/* Backdrop */}
      <div
        role="button"
        tabIndex={-1}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") {
            onClose();
          }
        }}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.18)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
          zIndex: 10,
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          background: theme.panelSolid,
          borderLeft: `0.5px solid ${theme.border}`,
          boxShadow: open ? "-20px 0 40px rgba(0,0,0,0.18)" : "none",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.32s cubic-bezier(.32,.72,.36,1)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          color: theme.ink,
          zIndex: 11,
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 22,
              fontStyle: "italic",
            }}
          >
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: theme.inkSoft,
              cursor: "pointer",
              fontSize: 18,
              padding: 4,
              outline: "none",
            }}
          >
            ✕
          </button>
        </div>

        {/* Appearance */}
        <DrawerRow theme={theme} label="Theme" hint={THEMES[themeName].name}>
          <Segmented
            options={["cream", "sepia", "dark"] as ThemeName[]}
            labels={["Paper", "Vellum", "Dark"]}
            value={themeName}
            theme={theme}
            accent={accent}
            onChange={(v) => onThemeChange(v as ThemeName)}
          />
        </DrawerRow>

        {/* Tempo */}
        <DrawerRow theme={theme} label="Tempo" hint={`${bpm} BPM`}>
          <input
            type="range"
            min="40"
            max="220"
            value={bpm}
            onInput={(e) =>
              onBpmChange(Number.parseInt((e.target as HTMLInputElement).value))
            }
            style={{ width: "100%", accentColor: accent }}
          />
        </DrawerRow>

        {/* Loop */}
        <DrawerRow
          theme={theme}
          label="Loop section"
          hint={
            showLoop && measureRange
              ? `Measures ${measureRange.from}–${measureRange.to}`
              : "Off"
          }
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Toggle
              on={showLoop}
              onChange={onLoopToggle}
              accent={accent}
              theme={theme}
            />
            {showLoop && measureRange && totalMeasures > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  marginLeft: 6,
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 12,
                  color: theme.ink,
                }}
              >
                <Stepper
                  value={measureRange.from}
                  min={1}
                  max={measureRange.to}
                  onChange={(v) =>
                    onMeasureRangeChange({ from: v, to: measureRange.to })
                  }
                  theme={theme}
                />
                <span style={{ color: theme.inkFaint }}>–</span>
                <Stepper
                  value={measureRange.to}
                  min={measureRange.from}
                  max={totalMeasures}
                  onChange={(v) =>
                    onMeasureRangeChange({ from: measureRange.from, to: v })
                  }
                  theme={theme}
                />
              </div>
            )}
          </div>
        </DrawerRow>

        {/* Tracks (if multiple) */}
        {tracks.length > 1 && (
          <DrawerRow theme={theme} label="Tracks" hint="">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {tracks.map((t) => (
                <label
                  key={t.index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedTracks.includes(t.index)}
                    onChange={() => onTrackToggle(t.index)}
                    style={{ accentColor: accent }}
                  />
                  <span style={{ color: theme.ink }}>
                    {t.name} ({t.noteCount} notes)
                  </span>
                </label>
              ))}
            </div>
          </DrawerRow>
        )}

        {/* Hands */}
        <DrawerRow theme={theme} label="Hands" hint={hands}>
          <Segmented
            options={["Left", "Both", "Right"]}
            value={hands}
            theme={theme}
            accent={accent}
            onChange={(v) => onHandsChange(v as "Left" | "Both" | "Right")}
          />
        </DrawerRow>

        {/* Count-in */}
        <DrawerRow
          theme={theme}
          label="Count-in"
          hint={countIn === 0 ? "Off" : `${countIn} measure`}
        >
          <Segmented
            options={["0", "1", "2"]}
            labels={["Off", "1", "2"]}
            value={String(countIn)}
            theme={theme}
            accent={accent}
            onChange={(v) => onCountInChange(Number.parseInt(v) as 0 | 1 | 2)}
          />
        </DrawerRow>

        {/* On miss */}
        <DrawerRow
          theme={theme}
          label="If I miss a note"
          hint={onMiss === "wait" ? "Wait for me" : "Skip it"}
        >
          <Segmented
            options={["wait", "skip"]}
            labels={["Wait", "Skip"]}
            value={onMiss}
            theme={theme}
            accent={accent}
            onChange={(v) => onOnMissChange(v as "wait" | "skip")}
          />
        </DrawerRow>

        {/* Footer — connection */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 14,
            borderTop: `0.5px solid ${theme.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: theme.inkSoft,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {connected ? "Connected" : "Not connected"}
          </span>
          {connected ? (
            <span
              style={{
                fontSize: 11,
                color: theme.ink,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#5E8C5A",
                  flexShrink: 0,
                }}
              />
              {bluetooth.deviceName}
            </span>
          ) : (
            <button
              type="button"
              onClick={bluetooth.connect}
              style={{
                fontSize: 11,
                color: accent,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                outline: "none",
              }}
            >
              Connect piano…
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Shared drawer sub-components ──────────────────────────────────────────────

function DrawerRow({
  theme,
  label,
  hint,
  children,
}: {
  theme: ThemeTokens;
  label: string;
  hint: string;
  children: preact.ComponentChildren;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: theme.ink }}>
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: theme.inkSoft }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  accent,
  theme,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  accent: string;
  theme: ThemeTokens;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 34,
        height: 20,
        padding: 2,
        background: on ? accent : theme.border,
        border: "none",
        borderRadius: 999,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        transition: "background 0.2s",
        outline: "none",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "white",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transform: on ? "translateX(14px)" : "translateX(0)",
          transition: "transform 0.2s",
        }}
      />
    </button>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  theme,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  theme: ThemeTokens;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: theme.border,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        style={{
          width: 18,
          height: 22,
          background: "transparent",
          border: "none",
          color: theme.inkSoft,
          cursor: "pointer",
          fontSize: 12,
          outline: "none",
        }}
      >
        −
      </button>
      <span
        style={{
          minWidth: 18,
          textAlign: "center",
          fontSize: 12,
          color: theme.ink,
        }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        style={{
          width: 18,
          height: 22,
          background: "transparent",
          border: "none",
          color: theme.inkSoft,
          cursor: "pointer",
          fontSize: 12,
          outline: "none",
        }}
      >
        +
      </button>
    </div>
  );
}

function Segmented({
  options,
  labels,
  value,
  theme,
  accent: _accent,
  onChange,
}: {
  options: string[];
  labels?: string[];
  value: string;
  theme: ThemeTokens;
  accent: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 2,
        background: theme.border,
        borderRadius: 8,
      }}
    >
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            background: o === value ? theme.panelSolid : "transparent",
            color: o === value ? theme.ink : theme.inkSoft,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            boxShadow: o === value ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            fontWeight: o === value ? 500 : 400,
            outline: "none",
          }}
        >
          {labels ? labels[i] : o}
        </button>
      ))}
    </div>
  );
}
