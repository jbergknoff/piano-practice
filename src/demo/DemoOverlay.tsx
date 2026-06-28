import { useEffect, useState } from "preact/hooks";
import { hexA } from "../theme";

interface DemoOverlayProps {
  /** App-owned dispatch ref — the exact path real BLE input ends up calling. */
  noteEventDispatchRef: {
    current: ((noteNumber: number, kind: "on" | "off") => void) | null;
  };
  accent: string;
}

// Roughly C3..B5 — a busy mid-keyboard range.
const LOW_NOTE = 48;
const NOTE_SPAN = 36;
// ~25 synthetic presses/sec while active, each released after a short hold.
const PRESS_INTERVAL_MS = 40;
const NOTE_HOLD_MS = 150;

/**
 * Desktop-only profiling harness (?demo=1). Fully self-contained: it renders its
 * own banner + "Play notes" toggle and, while active, sprays random note-on/off
 * events straight through the App-owned dispatch ref — the same path real BLE
 * input takes. With Playalong playing, this reproduces the marker + highlight
 * render load so a CPU/paint profile can be captured on the desktop without a
 * piano. Nothing here touches PracticeScreen; it depends only on the dispatch
 * ref. Mounted only under ?demo=1.
 */
export function DemoOverlay({
  noteEventDispatchRef,
  accent,
}: DemoOverlayProps) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const pendingOffs = new Set<ReturnType<typeof setTimeout>>();
    const interval = setInterval(() => {
      const note = LOW_NOTE + Math.floor(Math.random() * NOTE_SPAN);
      noteEventDispatchRef.current?.(note, "on");
      const off = setTimeout(() => {
        pendingOffs.delete(off);
        noteEventDispatchRef.current?.(note, "off");
      }, NOTE_HOLD_MS);
      pendingOffs.add(off);
    }, PRESS_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      for (const off of pendingOffs) {
        clearTimeout(off);
      }
    };
  }, [playing, noteEventDispatchRef]);

  return (
    <div
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 8px 5px 14px",
        borderRadius: 999,
        background: hexA(accent, 0.92),
        color: "#FFF7E5",
        boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        Demo
      </span>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        style={{
          border: "none",
          borderRadius: 999,
          padding: "5px 12px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          background: "#FFF7E5",
          color: "#222",
        }}
      >
        {playing ? "Stop notes" : "Play notes"}
      </button>
    </div>
  );
}
