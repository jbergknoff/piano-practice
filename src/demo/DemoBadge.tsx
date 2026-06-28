import { hexA } from "../theme";

/**
 * Small fixed badge shown while the ?demo=1 profiling harness is active, so the
 * simulated-input mode is never mistaken for a real session. Lives outside
 * PracticeScreen so the production component stays free of demo markup.
 */
export function DemoBadge({ accent }: { accent: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 18,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 3,
        padding: "4px 12px",
        borderRadius: 999,
        background: hexA(accent, 0.9),
        color: "#FFF7E5",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        pointerEvents: "none",
        boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
      }}
    >
      Demo
    </div>
  );
}
