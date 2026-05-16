import type { ThemeTokens } from "../theme";
import { hexA } from "../theme";
import type { useBluetooth } from "../useBluetooth";
import { BluetoothIcon } from "./icons";

export function ConnectionBadge({
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
    height: 38,
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
