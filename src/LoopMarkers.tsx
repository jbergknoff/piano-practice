interface Props {
  startX: number;
  endX: number;
  height: number;
  visible: boolean;
}

export function LoopMarkers({ startX, endX, height, visible }: Props) {
  if (!visible) {
    return null;
  }

  const lineStyle = {
    position: "absolute",
    top: 0,
    width: "2px",
    height: `${height}px`,
    pointerEvents: "none",
  };

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${startX}px`,
          width: `${Math.max(0, endX - startX)}px`,
          height: `${height}px`,
          backgroundColor: "rgba(0, 180, 0, 0.12)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          ...lineStyle,
          left: `${startX}px`,
          backgroundColor: "#00aa00",
        }}
      />
      <div
        style={{ ...lineStyle, left: `${endX}px`, backgroundColor: "#cc0000" }}
      />
    </>
  );
}
