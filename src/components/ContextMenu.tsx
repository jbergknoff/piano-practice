import { useEffect, useRef } from "preact/hooks";
import { FONT_SANS, glassPanel, type ThemeTokens } from "../theme";
import { useModalDialog } from "./dialog-support";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

/**
 * A menu at a point on screen. Rendering it opens it; choosing an item calls
 * its `onSelect` and then `onClose`; Escape or a click (or right-click)
 * anywhere outside it calls `onClose`.
 *
 * It is a modal `<dialog>` with a transparent backdrop, not a popover, so the
 * page behind it is inert while it is open: a click outside the menu lands on
 * the backdrop and only closes the menu, rather than also pressing whatever
 * is underneath. A popover's light dismiss would let that click through. (A
 * dialog also has no light dismiss to trip over: Chrome fires `contextmenu`
 * while the button is still down, and a popover shown then is dismissed by
 * the same click's release.)
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
  const menuRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useModalDialog(menuRef, onClose);

  // A right-click on the backdrop closes the menu too, instead of opening the
  // browser's own context menu on top of it.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    function onContextMenu(event: MouseEvent) {
      if (event.target === menu) {
        event.preventDefault();
        onCloseRef.current();
      }
    }
    menu.addEventListener("contextmenu", onContextMenu);
    return () => menu.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return (
    <dialog
      ref={menuRef}
      class="app-menu"
      aria-label="Actions"
      style={{
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
    </dialog>
  );
}
