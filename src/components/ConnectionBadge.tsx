import { useState } from "preact/hooks";
import type { ThemeTokens } from "../theme";
import { hexA } from "../theme";
import type { useBluetooth } from "../useBluetooth";
import { BluetoothIcon } from "./icons";

const BT_SUPPORTED = typeof navigator !== "undefined" && !!navigator.bluetooth;

// Coarse browser detection — only used to tailor the unsupported message.
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_BRAVE = "brave" in navigator;
const IS_CHROME_LIKE = /Chrome\//.test(ua) && !/Edg\//.test(ua) && !IS_BRAVE;
const IS_EDGE = /Edg\//.test(ua);
const IS_FIREFOX = /Firefox\//.test(ua);
const IS_SAFARI = /Safari\//.test(ua) && !/Chrome\//.test(ua);

const BT_IMPL_STATUS_URL =
  "https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md";

function unsupportedBody(accent: string) {
  const link = (
    <a
      href={BT_IMPL_STATUS_URL}
      target="_blank"
      rel="noreferrer"
      style={{ color: accent, textDecoration: "none" }}
    >
      implementation status page ↗
    </a>
  );

  if (IS_BRAVE) {
    return (
      <span>
        Brave blocks Web Bluetooth by default. To enable it, open{" "}
        <code style={{ fontSize: 11 }}>brave://flags</code>, search for{" "}
        <code style={{ fontSize: 11 }}>
          enable-experimental-web-platform-features
        </code>
        , set it to <strong>Enabled</strong>, then relaunch. See the {link} for
        more detail.
      </span>
    );
  }
  if (IS_SAFARI || IS_FIREFOX) {
    return (
      <span>
        Web Bluetooth is not supported in {IS_SAFARI ? "Safari" : "Firefox"}.
        Please open this page in a Chromium-based browser. See the {link} for
        the full picture.
      </span>
    );
  }
  if (IS_CHROME_LIKE || IS_EDGE) {
    return (
      <span>
        Web Bluetooth doesn't appear to be available. Make sure you're using a
        recent Chromium-based browser and that Bluetooth is enabled on your
        device. See the {link} for more detail.
      </span>
    );
  }
  return (
    <span>
      Web Bluetooth is not available in this browser. Please use a
      Chromium-based browser. See the {link} for the full picture.
    </span>
  );
}

export function ConnectionBadge({
  theme,
  accent,
  bluetooth,
  compact,
}: {
  theme: ThemeTokens;
  accent: string;
  bluetooth: ReturnType<typeof useBluetooth>;
  compact: boolean;
}) {
  const [showUnsupportedModal, setShowUnsupportedModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

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
    cursor: "pointer",
    color: hasError ? "#c62828" : theme.inkSoft,
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

  const title = connected
    ? `Connected · ${bluetooth.deviceName}`
    : connecting
      ? "Connecting…"
      : hasError
        ? (bluetooth.error ?? "Connection failed")
        : "Connect Bluetooth";

  function handleClick() {
    if (!BT_SUPPORTED) {
      setShowUnsupportedModal(true);
      return;
    }
    if (connected) {
      setShowStatusModal(true);
      return;
    }
    bluetooth.connect();
  }

  const modalBaseStyle = {
    position: "fixed" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 300,
    background: theme.panelSolid,
    border: `0.5px solid ${theme.border}`,
    borderRadius: 20,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
    width: "min(360px, calc(100vw - 40px))",
    padding: "24px 28px",
    fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  };

  const backdropStyle = {
    position: "fixed" as const,
    inset: 0,
    zIndex: 299,
    background: "rgba(0,0,0,0.3)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
  };

  const closeBtnStyle = {
    background: "transparent",
    border: "none",
    color: theme.inkSoft,
    cursor: "pointer",
    fontSize: 18,
    padding: 4,
    outline: "none",
    lineHeight: 1,
  };

  return (
    <>
      {compact ? (
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
      ) : (
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
            {connected
              ? (bluetooth.deviceName ?? "Connected")
              : connecting
                ? "Connecting…"
                : hasError
                  ? "Failed"
                  : "Connect"}
          </span>
        </button>
      )}

      {showUnsupportedModal && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop only closes */}
          <div
            style={backdropStyle}
            onClick={() => setShowUnsupportedModal(false)}
          />
          <div style={modalBaseStyle}>
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
                  fontStyle: "italic",
                  fontSize: 20,
                  color: theme.ink,
                }}
              >
                Bluetooth unavailable
              </span>
              <button
                type="button"
                onClick={() => setShowUnsupportedModal(false)}
                style={closeBtnStyle}
              >
                ✕
              </button>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: theme.inkSoft,
                lineHeight: 1.6,
              }}
            >
              {unsupportedBody(accent)}
            </p>
          </div>
        </>
      )}

      {showStatusModal && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop only closes */}
          <div
            style={backdropStyle}
            onClick={() => setShowStatusModal(false)}
          />
          <div style={modalBaseStyle}>
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
                  fontStyle: "italic",
                  fontSize: 20,
                  color: theme.ink,
                }}
              >
                Piano connection
              </span>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                style={closeBtnStyle}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: theme.ink,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#5E8C5A",
                  flexShrink: 0,
                }}
              />
              {bluetooth.deviceName}
            </div>
            <button
              type="button"
              onClick={() => setShowStatusModal(false)}
              style={{
                background: accent,
                border: "none",
                borderRadius: 10,
                color: "#FFF7E5",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 18px",
                alignSelf: "flex-end",
              }}
            >
              Done
            </button>
          </div>
        </>
      )}
    </>
  );
}
