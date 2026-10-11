import type { ComponentChildren, JSX } from "preact";
import { closeButtonStyle, serifTitle, type ThemeTokens } from "../theme";
import { Layer } from "./Layer";

interface ModalProps {
  /**
   * Called when the user dismisses the modal: Escape, a backdrop click, or the
   * header's ✕. The caller unmounts the modal in response.
   */
  onClose: () => void;
  /**
   * Runs right after the modal opens, in the same commit as its first render
   * (a layout effect). Use it to focus/select an input: in the first commit,
   * so a keystroke can't land before the selection does (see the
   * jump-to-measure flake in CLAUDE.md).
   */
  onShow?: () => void;
  /** Accessible name, announced when the dialog opens. */
  label: string;
  /** The panel's own look (background, radius, padding, size, layout). */
  style: JSX.CSSProperties;
  children: ComponentChildren;
}

/**
 * A centred panel over a dimmed, blurred page. Rendering it opens it;
 * unmounting it closes it. Escape or a press outside the panel calls
 * `onClose`. Built on `Layer` (see there for why it is a popover rather than
 * a `<dialog>`).
 */
export function Modal({ onClose, onShow, label, style, children }: ModalProps) {
  return (
    <Layer
      open={true}
      onClose={onClose}
      onShow={onShow}
      kind="modal"
      label={label}
      panelStyle={style}
    >
      {children}
    </Layer>
  );
}

/** Title plus ✕ close button, the header row shared by modals and drawers. */
export function ModalHeader({
  theme,
  title,
  titleSize = 22,
  onClose,
  closeLabel = "Close",
  style,
}: {
  theme: ThemeTokens;
  title: ComponentChildren;
  titleSize?: number;
  onClose: () => void;
  closeLabel?: string;
  style?: JSX.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        ...style,
      }}
    >
      <span style={serifTitle(theme, titleSize)}>{title}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        style={closeButtonStyle(theme)}
      >
        ✕
      </button>
    </div>
  );
}
