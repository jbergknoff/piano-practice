import type { PlaybackMode, PlaybackStatus } from "./usePlayback";

const BTN = {
  minHeight: "48px",
  minWidth: "48px",
  fontSize: "1.1rem",
  padding: "0 12px",
  touchAction: "manipulation",
};

interface Props {
  status: PlaybackStatus;
  mode: PlaybackMode;
  bpm: number;
  stepIndex: number;
  measureCount: number;
  loopStartMeasure: number;
  loopEndMeasure: number;
  scheduleReady: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSetMode: (mode: PlaybackMode) => void;
  onSetLoopStart: () => void;
  onSetLoopEnd: () => void;
  onSetBpm: (bpm: number) => void;
}

export function Controls({
  status,
  mode,
  bpm,
  loopStartMeasure,
  loopEndMeasure,
  scheduleReady,
  onPlay,
  onPause,
  onStop,
  onSetMode,
  onSetLoopStart,
  onSetLoopEnd,
  onSetBpm,
}: Props) {
  const disabled = !scheduleReady;
  const playing = status === "playing";

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "white",
        borderBottom: "1px solid #ddd",
        padding: "8px",
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        alignItems: "center",
      }}
    >
      {/* Play / pause */}
      <button
        type="button"
        style={BTN}
        disabled={disabled || mode === "ble"}
        onClick={playing ? onPause : onPlay}
      >
        {playing ? "⏸" : "▶"}
      </button>

      {/* Stop */}
      <button
        type="button"
        style={BTN}
        disabled={disabled || status === "idle"}
        onClick={onStop}
      >
        ■
      </button>

      {/* Mode toggle */}
      <span style={{ display: "flex", gap: "4px" }}>
        {(["playback", "ble"] as PlaybackMode[]).map((m) => (
          <button
            key={m}
            type="button"
            style={{
              ...BTN,
              background: mode === m ? "#2255ee" : undefined,
              color: mode === m ? "white" : undefined,
            }}
            disabled={disabled}
            onClick={() => onSetMode(m)}
          >
            {m === "playback" ? "Playback" : "BLE"}
          </button>
        ))}
      </span>

      {/* BPM slider (only relevant in playback mode) */}
      {mode === "playback" && (
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          BPM
          <input
            type="range"
            min="40"
            max="240"
            value={bpm}
            style={{
              minHeight: "32px",
              width: "90px",
              touchAction: "manipulation",
            }}
            onInput={(e) =>
              onSetBpm(Number((e.target as HTMLInputElement).value))
            }
          />
          {bpm}
        </label>
      )}

      {/* Loop controls */}
      <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        <button
          type="button"
          style={BTN}
          disabled={disabled}
          onClick={onSetLoopStart}
          title="Set loop start to current position"
        >
          [↦
        </button>
        <span style={{ fontSize: "0.9rem" }}>
          {loopStartMeasure + 1}–{loopEndMeasure + 1}
        </span>
        <button
          type="button"
          style={BTN}
          disabled={disabled}
          onClick={onSetLoopEnd}
          title="Set loop end to current position"
        >
          ↤]
        </button>
      </span>
    </div>
  );
}
