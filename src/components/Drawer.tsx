import type { ComponentChildren, JSX } from "preact";
import { Layer } from "./Layer";

/**
 * A full-height panel that slides in from one side over a dimmed page. Unlike
 * `Modal` it stays mounted and is driven by `open`, so it can animate out as
 * well as in. The slide is CSS (`Layer.tsx`): `@starting-style` gives the
 * entry transition, and transitioning `display` and `overlay` with
 * `allow-discrete` keeps the closing layer rendered until it has slid away.
 * Browsers without those features simply skip the animation.
 */
export function Drawer({
  open,
  onClose,
  side,
  label,
  style,
  children,
}: {
  open: boolean;
  /** Called on Escape or a press outside the panel; the caller sets `open` to false. */
  onClose: () => void;
  side: "left" | "right";
  label: string;
  /** The panel's own look (width, background, padding, gap). Children are laid out in a column. */
  style: JSX.CSSProperties;
  children: ComponentChildren;
}) {
  return (
    <Layer
      open={open}
      onClose={onClose}
      kind="drawer"
      side={side}
      label={label}
      panelStyle={style}
    >
      {children}
    </Layer>
  );
}
