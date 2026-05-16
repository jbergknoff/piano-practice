import type { ThemeTokens } from "../theme";
import { hexA } from "../theme";
import type { useBluetooth } from "../useBluetooth";
import { BluetoothIcon } from "./icons";

const BT_SUPPORTED = typeof navigator !== "undefined" && !!navigator.bluetooth;

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
  const hasError = bluetooth.status === "error";

  const dotColor = connected
    ? "#5E8C5A"
    : hasError
      ? "#c62828"
      : theme.inkFaint;

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
    cursor: connected || !BT_SUPPORTED ? "default" : "pointer",
    color: hasError ? "#c62828" : theme.inkSoft,
    outline: "none",
    opacity: !BT_SUPPORTED ? 0.5 : 1,
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

  const title = !BT_SUPPORTED
    ? "Web Bluetooth is not supported in this browser (use Chrome or Edge)"
    : connected
      ? `Connected · ${bluetooth.deviceName}`
      : connecting
        ? "Connecting…"
        : hasError
          ? (bluetooth.error ?? "Connection failed")
          : "Connect Bluetooth";

  const handleClick =
    !BT_SUPPORTED || connected ? undefined : bluetooth.connect;

  if (compact) {
    return (
      <button
        type="button"
        title={title}
        onClick={handleClick}
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
      title={title}
      onClick={handleClick}
      style={
        {
          ...pillStyle,
          padding: "0 12px",
          gap: 7,
          color: hasError ? "#c62828" : theme.ink,
        } as Record<string, string | number>
      }
    >
      {dot}
      <BluetoothIcon size={11} />
      <span
        style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.01em" }}
      >
        {!BT_SUPPORTED
          ? "Not supported"
          : connected
            ? (bluetooth.deviceName ?? "Connected")
            : connecting
              ? "Connecting…"
              : hasError
                ? "Failed"
                : "Connect"}
      </span>
    </button>
  );
}
