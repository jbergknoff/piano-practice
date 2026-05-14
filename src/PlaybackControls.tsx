interface PlaybackControlsProps {
  isPlaying: boolean;
  bpm: number;
  currentBeat: number;
  totalBeats: number;
  timeSigNum: number;
  waitMode: boolean;
  measureRange: { from: number; to: number } | null;
  onPlayPause: () => void;
  onStop: () => void;
  onBpmChange: (bpm: number) => void;
  onToggleWaitMode: () => void;
  onMeasureRangeChange: (range: { from: number; to: number } | null) => void;
}

export function PlaybackControls({
  isPlaying,
  bpm,
  currentBeat,
  totalBeats,
  timeSigNum,
  waitMode,
  measureRange,
  onPlayPause,
  onStop,
  onBpmChange,
  onToggleWaitMode,
  onMeasureRangeChange,
}: PlaybackControlsProps) {
  const totalMeasures = totalBeats > 0 ? Math.ceil(totalBeats / timeSigNum) : 0;
  const currentMeasure =
    totalBeats > 0 ? Math.floor(currentBeat / timeSigNum) + 1 : 1;

  function handleBpmInput(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    if (val >= 20 && val <= 300) {
      onBpmChange(val);
    }
  }

  function handleFromInput(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    if (!val || val < 1 || val > totalMeasures) {
      return;
    }
    const to = measureRange ? Math.max(measureRange.to, val) : totalMeasures;
    onMeasureRangeChange({ from: val, to });
  }

  function handleToInput(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    if (!val || val < 1 || val > totalMeasures) {
      return;
    }
    const from = measureRange ? Math.min(measureRange.from, val) : 1;
    onMeasureRangeChange({ from, to: val });
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

      {totalMeasures > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "14px", whiteSpace: "nowrap" }}>Focus:</span>
          <input
            type="number"
            min={1}
            max={totalMeasures}
            value={measureRange?.from ?? ""}
            placeholder="1"
            onInput={handleFromInput}
            style={{ width: "46px", fontSize: "14px", textAlign: "center" }}
            aria-label="Focus from measure"
          />
          <span style={{ fontSize: "14px" }}>–</span>
          <input
            type="number"
            min={1}
            max={totalMeasures}
            value={measureRange?.to ?? ""}
            placeholder={String(totalMeasures)}
            onInput={handleToInput}
            style={{ width: "46px", fontSize: "14px", textAlign: "center" }}
            aria-label="Focus to measure"
          />
          {measureRange && (
            <button
              type="button"
              onClick={() => onMeasureRangeChange(null)}
              style={{
                fontSize: "14px",
                width: "24px",
                height: "24px",
                cursor: "pointer",
                border: "1px solid #ccc",
                borderRadius: "4px",
                background: "#f5f5f5",
                lineHeight: 1,
                padding: 0,
              }}
              aria-label="Clear focus range"
            >
              ×
            </button>
          )}
        </div>
      )}

      {totalBeats > 0 && (
        <span style={{ fontSize: "13px", color: "#555" }}>
          Measure {currentMeasure} / {totalMeasures}
        </span>
      )}
    </div>
  );
}
