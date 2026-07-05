import { useEffect, useState } from "preact/hooks";
import type { PianoController, PianoSource } from "../hooks/use-piano";
import type { ThemeTokens } from "../theme";
import {
  dimBackdrop,
  FONT_MONO,
  FONT_SANS,
  glassPanel,
  hexA,
  modalActionButtonStyle,
  radius,
  serifTitle,
} from "../theme";
import { BluetoothIcon, UsbIcon } from "./icons";

// Coarse browser detection — only used to tailor the unsupported message.
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_BRAVE = "brave" in navigator;
const IS_CHROME_LIKE = /Chrome\//.test(ua) && !/Edg\//.test(ua) && !IS_BRAVE;
const IS_EDGE = /Edg\//.test(ua);
const IS_FIREFOX = /Firefox\//.test(ua);
const IS_SAFARI = /Safari\//.test(ua) && !/Chrome\//.test(ua);
const IS_CHROMIUM = IS_CHROME_LIKE || IS_EDGE || IS_BRAVE;

const BT_IMPL_STATUS_URL =
  "https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md";

function compatibilityLink(accent: string, label: string) {
  return (
    <a
      href={BT_IMPL_STATUS_URL}
      target="_blank"
      rel="noreferrer"
      style={{ color: accent, textDecoration: "none" }}
    >
      {label}
    </a>
  );
}

function unsupportedBody(accent: string) {
  const link = compatibilityLink(accent, "implementation status page ↗");

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
        Connecting a piano needs Web Bluetooth or Web MIDI, which{" "}
        {IS_SAFARI ? "Safari" : "Firefox"} doesn't support. Please open this
        page in a Chromium-based browser. See the {link} for the full picture.
      </span>
    );
  }
  if (IS_CHROME_LIKE || IS_EDGE) {
    return (
      <span>
        No way to connect a piano is available. Make sure you're using a recent
        Chromium-based browser and that Bluetooth (or a USB MIDI device) is
        available on your device. See the {link} for more detail.
      </span>
    );
  }
  return (
    <span>
      Connecting a piano needs Web Bluetooth or Web MIDI, neither of which is
      available in this browser. Please use a Chromium-based browser. See the{" "}
      {link} for the full picture.
    </span>
  );
}

function errorBody(accent: string, source: PianoSource | null) {
  if (source === "midi") {
    return (
      <span>
        No USB MIDI device was found. Make sure your piano is connected and
        powered on, then try again. This error comes from your browser's Web
        MIDI API.
      </span>
    );
  }
  return (
    <span>
      The browser couldn't connect to the selected device over Bluetooth. This
      error comes from your browser's Web Bluetooth API. Not every browser and
      operating system fully supports BLE MIDI — see the{" "}
      {compatibilityLink(accent, "Web Bluetooth compatibility matrix ↗")} for
      what's known to work.
      {IS_CHROMIUM && (
        <>
          {" "}
          On a Chromium-based browser, it often helps to open{" "}
          <code style={{ fontSize: 11 }}>chrome://flags</code> and enable both{" "}
          <strong>Experimental Web Platform features</strong> and{" "}
          <strong>Use the new permissions backend for Web Bluetooth</strong>,
          then relaunch.
        </>
      )}
    </span>
  );
}

export function ConnectionBadge({
  theme,
  accent,
  piano,
  compact,
}: {
  theme: ThemeTokens;
  accent: string;
  piano: PianoController;
  compact: boolean;
}) {
  const [showUnsupportedModal, setShowUnsupportedModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showChooserModal, setShowChooserModal] = useState(false);

  const connected = piano.status === "connected";
  const connecting = piano.status === "connecting";
  const hasError = piano.status === "error";
  const supported = piano.bluetoothSupported || piano.midiSupported;

  // A failed connection attempt surfaces the error modal automatically; the
  // badge itself keeps its normal click behaviour (retry / show instructions).
  useEffect(() => {
    if (hasError) {
      setShowErrorModal(true);
    }
  }, [hasError]);

  const dotColor = connected
    ? "#5E8C5A"
    : hasError
      ? "#c62828"
      : theme.inkFaint;

  const pillStyle = {
    height: 38,
    ...glassPanel(theme),
    borderRadius: radius.lg,
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
    ? `Connected · ${piano.deviceName}`
    : connecting
      ? "Connecting…"
      : hasError
        ? (piano.error ?? "Connection failed")
        : "Connect a piano";

  function handleClick() {
    if (!supported) {
      setShowUnsupportedModal(true);
      return;
    }
    if (connected) {
      setShowStatusModal(true);
      return;
    }
    if (piano.bluetoothSupported && piano.midiSupported) {
      setShowChooserModal(true);
      return;
    }
    if (piano.bluetoothSupported) {
      piano.connectBluetooth();
      return;
    }
    piano.connectMidi();
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
    fontFamily: FONT_SANS,
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  };

  const backdropStyle = { ...dimBackdrop(), zIndex: 299 };

  const closeButtonStyle = {
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
              ? (piano.deviceName ?? "Connected")
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
              <span style={serifTitle(theme, 20)}>Can't connect a piano</span>
              <button
                type="button"
                onClick={() => setShowUnsupportedModal(false)}
                style={closeButtonStyle}
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

      {showChooserModal && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop only closes */}
          <div
            style={backdropStyle}
            onClick={() => setShowChooserModal(false)}
          />
          <div style={modalBaseStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={serifTitle(theme, 20)}>Connect a piano</span>
              <button
                type="button"
                onClick={() => setShowChooserModal(false)}
                style={closeButtonStyle}
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
              How is your piano connected?
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowChooserModal(false);
                  piano.connectBluetooth();
                }}
                style={{
                  ...modalActionButtonStyle(theme, "accent", accent),
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <BluetoothIcon size={13} />
                Bluetooth
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowChooserModal(false);
                  piano.connectMidi();
                }}
                style={{
                  ...modalActionButtonStyle(theme, "accent", accent),
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <UsbIcon size={13} />
                USB (Web MIDI)
              </button>
            </div>
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
              <span style={serifTitle(theme, 20)}>Piano connection</span>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                style={closeButtonStyle}
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
              {piano.deviceName}
              <span style={{ color: theme.inkSoft }}>
                {piano.source === "midi" ? "· via MIDI" : "· via Bluetooth"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                style={modalActionButtonStyle(theme, "accent", accent)}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}

      {showErrorModal && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop only closes */}
          <div style={backdropStyle} onClick={() => setShowErrorModal(false)} />
          <div style={modalBaseStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={serifTitle(theme, 20)}>Connection failed</span>
              <button
                type="button"
                onClick={() => setShowErrorModal(false)}
                style={closeButtonStyle}
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
              {errorBody(accent, piano.source)}
            </p>
            <div
              style={{
                margin: 0,
                padding: "10px 12px",
                fontFamily: FONT_MONO,
                fontSize: 11.5,
                lineHeight: 1.5,
                color: theme.ink,
                background: hexA(theme.inkFaint, 0.12),
                border: `0.5px solid ${theme.border}`,
                borderRadius: radius.md,
                userSelect: "text",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {piano.error ?? "Connection failed"}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setShowErrorModal(false)}
                style={modalActionButtonStyle(theme, "accent", accent)}
              >
                Okay
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
