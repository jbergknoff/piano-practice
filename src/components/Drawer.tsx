import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useModalDialog } from "./dialog-support";

/**
 * A full-height panel pinned to one side of the screen, built on a native
 * `<dialog>` opened with `showModal()` like `Modal`: top layer, Escape to
 * close, an inert page behind it, and a press on the backdrop closes it.
 *
 * It appears and disappears without a slide. An animated version stuttered
 * on a phone: `showModal()` makes the rest of the page inert, which restyles
 * every element (~30 ms with a long score on a fast desktop, several times
 * that on a phone), and that landed right as the slide began. Without the
 * animation the same cost is just a moment's delay before the drawer shows.
 */
export function Drawer(props: DrawerProps) {
  return props.open ? <OpenDrawer {...props} /> : null;
}

interface DrawerProps {
  open: boolean;
  /** Called on Escape or a backdrop click; the caller sets `open` to false. */
  onClose: () => void;
  side: "left" | "right";
  label: string;
  /** The panel's own look (width, background, padding, gap). Children are laid out in a column. */
  style: JSX.CSSProperties;
  children: ComponentChildren;
}

function OpenDrawer({ onClose, side, label, style, children }: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef, onClose);
  return (
    <dialog
      ref={dialogRef}
      class="app-drawer"
      data-side={side}
      aria-label={label}
      style={style}
    >
      {children}
    </dialog>
  );
}
