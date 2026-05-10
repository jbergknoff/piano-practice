interface PlaybackControlsProps {
  isPlaying: boolean;
  bpm: number;
  currentBeat: number;
  totalBeats: number;
  timeSigNum: number;
  waitMode: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onBpmChange: (bpm: number) => void;
  onToggleWaitMode: () => void;
}

export function PlaybackControls({
  isPlaying,
  bpm,
  currentBeat,
  totalBeats,
  timeSigNum,
  waitMode,
  onPlayPause,
  onStop,
  onBpmChange,
  onToggleWaitMode,
}: PlaybackControlsProps) {
  const currentMeasure =
    totalBeats > 0 ? Math.floor(currentBeat / timeSigNum) + 1 : 1;
  const totalMeasures = totalBeats > 0 ? Math.ceil(totalBeats / timeSigNum) : 0;

  function handleBpmInput(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    if (val >= 20 && val <= 300) {
      onBpmChange(val);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 4px",
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={onPlayPause}
        disabled={waitMode}
        style={{
          fontSize: "18px",
          width: "40px",
          height: "40px",
          cursor: waitMode ? "default" : "pointer",
          border: "1px solid #ccc",
          borderRadius: "6px",
          background: isPlaying ? "#e8f4fd" : "#f5f5f5",
          opacity: waitMode ? 0.4 : 1,
        }}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      <button
        type="button"
        onClick={onStop}
        style={{
          fontSize: "18px",
          width: "40px",
          height: "40px",
          cursor: "pointer",
          border: "1px solid #ccc",
          borderRadius: "6px",
          background: "#f5f5f5",
        }}
        aria-label="Stop"
      >
        ⏹
      </button>

      <button
        type="button"
        onClick={onToggleWaitMode}
        style={{
          fontSize: "14px",
          padding: "0 14px",
          height: "40px",
          cursor: "pointer",
          border: `1px solid ${waitMode ? "#e65100" : "#ccc"}`,
          borderRadius: "6px",
          background: waitMode ? "#fff3e0" : "#f5f5f5",
          fontWeight: waitMode ? "bold" : "normal",
          color: waitMode ? "#e65100" : "inherit",
        }}
        aria-pressed={waitMode}
        aria-label={waitMode ? "Disable wait mode" : "Enable wait mode"}
      >
        Wait
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <label style={{ fontSize: "14px", whiteSpace: "nowrap" }}>
          BPM:
          <input
            type="range"
            min={20}
            max={300}
            value={bpm}
            onInput={handleBpmInput}
            style={{ width: "120px" }}
          />
        </label>
        <input
          type="number"
          min={20}
          max={300}
          value={bpm}
          onInput={handleBpmInput}
          style={{ width: "52px", fontSize: "14px", textAlign: "center" }}
        />
      </div>

      {totalBeats > 0 && (
        <span style={{ fontSize: "13px", color: "#555" }}>
          Measure {currentMeasure} / {totalMeasures}
        </span>
      )}
    </div>
  );
}
