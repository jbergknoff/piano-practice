import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

// A layer is the shared shell behind `Modal`, `Drawer` and `ContextMenu`: one
// full-screen `popover="manual"` element holding a scrim (the dimmed area
// behind the panel, and the thing that catches outside clicks) and the panel
// itself.
//
// Why a popover rather than a <dialog> opened with showModal(): showModal()
// makes the whole rest of the page inert, and flipping inertness restyles
// every element. With the sheet music on screen that is ~18,000 elements and
// ~30 ms of style recalculation on a fast desktop, paid on every open and
// close: several times that on a phone, right as a drawer's slide begins,
// which read as stutter. Showing a popover costs nothing measurable. (Ariakit
// hit the same cost toggling `inert` on large pages:
// https://github.com/ariakit/ariakit/issues/7697.)
//
// A popover still gives the top layer, so a layer paints above everything
// whatever the z-index or stacking context of the component rendering it. What
// it doesn't give, the layer does itself:
//
// - Blocking the page: the scrim covers the viewport and takes every press
//   outside the panel, so nothing underneath is clicked. (A popover's own
//   `::backdrop` can't do this: the browser makes it `pointer-events: none`
//   with `!important`, so clicks go straight through it.)
// - Escape: one document-level listener closes the topmost open layer.
//
// What is given up is the native focus trap: Tab can still reach the page
// behind a layer. For an app used on a phone that matters little.

const LAYER_CSS = `
.app-layer {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  overflow: visible;
  /* Only matters outside the top layer: in browsers without the overlay
     transition (Safari), a closing drawer leaves the top layer at once but
     stays displayed for its slide-out, and must still paint above the page. */
  z-index: 1000;
}
.app-layer:not(:popover-open) { pointer-events: none; }
.app-layer-scrim { position: absolute; inset: 0; }
/* The panel is a <dialog open> purely for its semantics (role, name): it is
   never opened with show()/showModal(), so it adds no top layer or inertness
   of its own. Reset the UA's dialog styles; each call site styles it inline. */
.app-layer-panel {
  position: absolute;
  inset: auto;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
}

.app-layer[data-kind="modal"] > .app-layer-scrim {
  background: rgba(0, 0, 0, 0.3);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.app-layer[data-kind="modal"] > .app-layer-panel {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.app-layer[data-kind="drawer"] {
  transition:
    overlay 0.32s allow-discrete,
    display 0.32s allow-discrete;
}
.app-layer[data-kind="drawer"] > .app-layer-scrim {
  background: rgba(0, 0, 0, 0.18);
  opacity: 0;
  transition: opacity 0.25s ease;
}
.app-layer[data-kind="drawer"] > .app-layer-panel {
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  transition: transform 0.32s cubic-bezier(0.32, 0.72, 0.36, 1);
}
.app-layer[data-kind="drawer"] > .app-layer-panel[data-side="left"] {
  left: 0;
  transform: translateX(-100%);
}
.app-layer[data-kind="drawer"] > .app-layer-panel[data-side="right"] {
  right: 0;
  transform: translateX(100%);
}
.app-layer[data-kind="drawer"]:popover-open > .app-layer-scrim { opacity: 1; }
.app-layer[data-kind="drawer"]:popover-open > .app-layer-panel { transform: none; }
@starting-style {
  .app-layer[data-kind="drawer"]:popover-open > .app-layer-scrim { opacity: 0; }
  .app-layer[data-kind="drawer"]:popover-open > .app-layer-panel[data-side="left"] {
    transform: translateX(-100%);
  }
  .app-layer[data-kind="drawer"]:popover-open > .app-layer-panel[data-side="right"] {
    transform: translateX(100%);
  }
}
`;

function injectLayerStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  const elementId = "app-layer-styles";
  if (document.getElementById(elementId)) {
    return;
  }
  const style = document.createElement("style");
  style.id = elementId;
  style.textContent = LAYER_CSS;
  document.head.appendChild(style);
}
injectLayerStyles();

// Open layers, oldest first. Escape closes the last one, so a layer opened
// from another (say, a modal over a drawer) is dismissed first.
const openLayers: Array<{ close: () => void }> = [];
if (typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || openLayers.length === 0) {
      return;
    }
    event.preventDefault();
    openLayers[openLayers.length - 1].close();
  });
}

export interface LayerProps {
  open: boolean;
  /**
   * Called when the user dismisses the layer: Escape, or a press on the scrim.
   * The caller closes it (unmounts it, or sets `open` to false).
   */
  onClose: () => void;
  /**
   * Runs right after the layer is shown, in the same commit as the render that
   * shows it (a layout effect): the place to focus an input, so a keystroke
   * can't land before the focus does (see the jump-to-measure flake in
   * CLAUDE.md).
   */
  onShow?: () => void;
  kind: "modal" | "drawer" | "menu";
  /** Drawers only: the edge the panel slides in from. */
  side?: "left" | "right";
  /** Accessible name for the panel. */
  label: string;
  /** The panel's own look (background, radius, padding, size, position). */
  panelStyle: JSX.CSSProperties;
  children: ComponentChildren;
}

export function Layer({
  open,
  onClose,
  onShow,
  kind,
  side,
  label,
  panelStyle,
  children,
}: LayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;

  // Show/hide the popover with `open`, and keep the Escape stack in step.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || !open) {
      return;
    }
    if (!layer.matches(":popover-open")) {
      layer.showPopover();
    }
    onShowRef.current?.();
    const entry = { close: () => onCloseRef.current() };
    openLayers.push(entry);
    return () => {
      const index = openLayers.indexOf(entry);
      if (index !== -1) {
        openLayers.splice(index, 1);
      }
      if (layer.isConnected && layer.matches(":popover-open")) {
        layer.hidePopover();
      }
    };
  }, [open]);

  // A click on the scrim closes the layer, but only if the press also started
  // there: a drag that begins in the panel (say, selecting text) and is
  // released over the scrim must not close it. A right-click on the scrim
  // closes it too, instead of opening the browser's own menu over the layer.
  //
  // Attached with addEventListener rather than an `onClick` prop: the scrim
  // is not a control a keyboard user needs (Escape closes every layer), so
  // it shouldn't pose as one.
  useLayoutEffect(() => {
    const scrim = scrimRef.current;
    if (!scrim) {
      return;
    }
    let pressStartedOnScrim = false;
    function onPointerDown(event: PointerEvent) {
      pressStartedOnScrim = event.target === scrim;
    }
    function onClick(event: MouseEvent) {
      if (pressStartedOnScrim && event.target === scrim) {
        onCloseRef.current();
      }
      pressStartedOnScrim = false;
    }
    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
      onCloseRef.current();
    }
    scrim.addEventListener("pointerdown", onPointerDown);
    scrim.addEventListener("click", onClick);
    scrim.addEventListener("contextmenu", onContextMenu);
    return () => {
      scrim.removeEventListener("pointerdown", onPointerDown);
      scrim.removeEventListener("click", onClick);
      scrim.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  return (
    <div ref={layerRef} popover="manual" class="app-layer" data-kind={kind}>
      <div ref={scrimRef} class="app-layer-scrim" />
      <dialog
        open
        class="app-layer-panel"
        aria-modal="true"
        aria-label={label}
        data-side={side}
        style={panelStyle}
      >
        {children}
      </dialog>
    </div>
  );
}
