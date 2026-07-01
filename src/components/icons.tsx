import { FONT_MONO } from "../theme";

export function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

export function StopIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function ResetIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
      <path
        d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.08a1.7 1.7 0 00-1.11-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 005 15.18a1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.08A1.7 1.7 0 005 9.07a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.01A1.7 1.7 0 0010 3.18V3a2 2 0 114 0v.08a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.01a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.08a1.7 1.7 0 00-1.55 1z"
        stroke="currentColor"
        stroke-width="1.4"
      />
    </svg>
  );
}

export function BluetoothIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 7l10 10-5 4V3l5 4L7 17"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function SectionsIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: size * 0.9,
        lineHeight: 1,
        fontFamily: FONT_MONO,
        letterSpacing: "-0.05em",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {"{}"}
    </span>
  );
}

export function PencilIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="10" x2="10" y2="18" />
      <line x1="14" y1="10" x2="14" y2="18" />
    </svg>
  );
}

export function OpenFileIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 347.28" aria-hidden="true">
      {/* Folder outline from https://uxwing.com/open-folder-outline-icon/ */}
      <path
        d="M121.35 118.09l260.64 0 0 -31.3c0.73,-7.76 -4.67,-9.69 -11.24,-9.98 -3.77,-0.18 -7.97,-0.2 -11.76,-0.01l-150.17 0c-36.03,0 -43.17,-19.04 -49.96,-37.13 -3.87,-10.32 -7.56,-20.17 -22.65,-20.17l-104.38 0c-6.76,0 -12.33,5.57 -12.33,12.33l0 253.04 61.44 -139.95c6.5,-14.82 24.13,-26.83 40.41,-26.83zm280.14 0l86.05 0c19.11,0 29.72,16.28 21.83,34.29l0.03 0.01 -73.77 168.06c-6.5,14.83 -24.14,26.83 -40.41,26.83l-366.19 0c-7.65,0 -13.84,-2.56 -18.08,-6.74 -6.2,-5.19 -10.95,-17.13 -10.95,-25.05l0 -283.66c0,-17.52 14.31,-31.83 31.83,-31.83l104.38 0c28.52,0 34.55,16.06 40.86,32.89 4.46,11.89 9.15,24.4 31.75,24.4 51.2,0 102.48,0.33 153.67,0.02 3.05,-0.03 6.18,-0.06 9.1,0.07 16.41,0.76 30.82,5.4 29.88,29.41l0.02 31.3zm85.97 19.05l-366.19 0c-8.66,0 -19,7.42 -22.44,15.25l-73.77 168.06 -0.03 -0.01c-2.05,4.68 -1.46,7.8 4.07,7.8l366.2 0c8.66,0 18.99,-7.43 22.43,-15.26l73.77 -168.06c0.07,0.03 4.09,-7.78 -4.04,-7.78z"
        fill="currentColor"
      />
    </svg>
  );
}
