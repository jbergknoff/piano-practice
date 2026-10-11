import { useRef } from "preact/hooks";
import { FONT_SANS, glassPanel, type ThemeTokens } from "../theme";
import { Layer } from "./Layer";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

/**
 * A menu at a point on screen. Rendering it opens it; choosing an item calls
 * its `onSelect` and then `onClose`; Escape or a click (or right-click)
 * anywhere outside it calls `onClose`.
 *
 * It is a `Layer` with a transparent scrim, so a click outside the menu lands
 * on the scrim and only closes the menu, rather than also pressing whatever is
 * underneath. (A plain `popover="auto"` menu would light-dismiss and let that
 * click through, and would be dismissed by the very click that opens it, since
 * Chrome fires `contextmenu` while the button is still down.)
 */
export function ContextMenu({
  clientX,
  clientY,
  items,
  onClose,
  theme,
}: {
  clientX: number;
  clientY: number;
  items: ContextMenuItem[];
  onClose: () => void;
  theme: ThemeTokens;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  return (
    <Layer
      open={true}
      onClose={onClose}
      kind="menu"
      label="Actions"
      panelStyle={{
        left: clientX + 4,
        top: clientY + 4,
        ...glassPanel(theme),
        borderRadius: 12,
        padding: 4,
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
        display: "flex",
        flexDirection: "column",
        minWidth: 180,
      }}
    >
      {items.map(({ label, onSelect }) => (
        <button
          key={label}
          type="button"
          onClick={() => {
            onSelect();
            onCloseRef.current();
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "8px 12px",
            textAlign: "left",
            fontSize: 13,
            color: theme.ink,
            borderRadius: 8,
            fontFamily: FONT_SANS,
            width: "100%",
          }}
        >
          {label}
        </button>
      ))}
    </Layer>
  );
}
