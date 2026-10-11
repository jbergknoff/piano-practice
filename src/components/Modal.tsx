import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { closeButtonStyle, serifTitle, type ThemeTokens } from "../theme";
import { useModalDialog } from "./dialog-support";

interface ModalProps {
  /**
   * Called when the user dismisses the modal: Escape, a backdrop click, or the
   * header's ✕. The caller unmounts the modal in response.
   */
  onClose: () => void;
  /**
   * Runs right after the dialog opens, in the same commit as its first render
   * (a layout effect). Use it to focus/select an input: it has to happen after
   * `showModal()`, which moves focus into the dialog itself, and in the first
   * commit, so a keystroke can't land before the selection does (see the
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
 * A centred modal panel, built on a native `<dialog>` opened with
 * `showModal()`. Rendering it opens it; unmounting it closes it. The platform
 * provides what the old hand-built modals approximated or missed:
 *
 * - the top layer, so the panel paints above everything else whatever the
 *   z-index or stacking context of the component that renders it;
 * - Escape to close;
 * - `inert` on the rest of the page, so focus and clicks stay inside;
 * - `::backdrop` for the dimmed, blurred layer behind the panel.
 */
export function Modal({ onClose, onShow, label, style, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef, onClose, onShow);

  return (
    <dialog ref={dialogRef} class="app-modal" aria-label={label} style={style}>
      {children}
    </dialog>
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
