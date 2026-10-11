import { useLayoutEffect, useRef } from "preact/hooks";
import { FONT_SANS, glassPanel, type ThemeTokens } from "../theme";
import "./dialog-support";

// How many pointers are currently pressed, tracked document-wide from module
// load so the menu can tell whether the press that opened it is still going.
let activePointers = 0;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    () => {
      activePointers += 1;
    },
    true,
  );
  for (const type of ["pointerup", "pointercancel"]) {
    window.addEventListener(
      type,
      () => {
        activePointers = Math.max(0, activePointers - 1);
      },
      true,
    );
  }
}

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

/**
 * A menu at a point on screen, built on `popover="auto"`: the platform puts it
 * in the top layer and closes it on Escape or on a press anywhere outside it
 * ("light dismiss"), reporting either through `onClose`. Choosing an item
 * calls its `onSelect` and then `onClose`.
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
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    function onToggle(event: Event) {
      if ((event as ToggleEvent).newState === "closed") {
        onCloseRef.current();
      }
    }
    menu.addEventListener("toggle", onToggle);
    return () => menu.removeEventListener("toggle", onToggle);
  }, []);

  // Show on mount, and again when re-opened at a new point. A right-click
  // while the menu is open first light-dismisses it (on pointerdown), then
  // asks for it at the new point; the browser coalesces the two queued
  // "toggle" events into one open→open event, so `onClose` is not called and
  // the menu simply reappears where it was asked for.
  //
  // Showing waits for the opening press to end. Chrome fires `contextmenu`
  // while the button (or a long-pressing finger) is still down, and popover
  // light dismiss runs on the *pointerup*: a menu shown mid-press would be
  // dismissed by the very press that opened it. So if a press is still in
  // progress, show the menu just after it ends.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new position is the trigger to re-show
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    function show() {
      if (menu?.isConnected && !menu.matches(":popover-open")) {
        menu.showPopover();
      }
    }
    if (activePointers === 0) {
      show();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onPressEnd() {
      window.removeEventListener("pointerup", onPressEnd, true);
      window.removeEventListener("pointercancel", onPressEnd, true);
      // A task later, so the press's own light dismiss has already run.
      timer = setTimeout(show, 0);
    }
    window.addEventListener("pointerup", onPressEnd, true);
    window.addEventListener("pointercancel", onPressEnd, true);
    return () => {
      window.removeEventListener("pointerup", onPressEnd, true);
      window.removeEventListener("pointercancel", onPressEnd, true);
      clearTimeout(timer);
    };
  }, [clientX, clientY]);

  // No inline `display` on the menu: it would override the browser's
  // `display: none` for a hidden popover. The items stack as blocks instead.
  return (
    <div
      ref={menuRef}
      popover="auto"
      class="app-popover"
      style={{
        left: clientX + 4,
        top: clientY + 4,
        ...glassPanel(theme),
        borderRadius: 12,
        padding: 4,
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
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
            display: "block",
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
    </div>
  );
}
