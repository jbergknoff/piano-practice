import { useFullscreen } from "../hooks/use-fullscreen";
import type { ThemeTokens } from "../theme";
import { cornerButtonStyle } from "../theme";
import { CollapseIcon, ExpandIcon } from "./icons";

/**
 * Enters fullscreen and locks the screen to landscape (see `useFullscreen` for
 * the platform matrix). Renders nothing where fullscreen is unavailable, so
 * iPhone Safari sees no dead button.
 */
export function FullscreenButton({ theme }: { theme: ThemeTokens }) {
  const { supported, isFullscreen, toggle } = useFullscreen();

  if (!supported) {
    return null;
  }

  return (
    <button
      type="button"
      // Marks this button as the one place a tap means "fullscreen, my call" —
      // `preserveFullscreenAcrossPicker`'s restore stands aside for it.
      data-fullscreen-toggle
      onClick={toggle}
      style={cornerButtonStyle(theme)}
      title={isFullscreen ? "Exit fullscreen" : "Fullscreen (landscape)"}
    >
      {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
    </button>
  );
}
