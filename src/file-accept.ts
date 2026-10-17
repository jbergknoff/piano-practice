// The `accept` attribute for the app's two file inputs (the landing screen's
// drop zone and the practice screen's open-file button).
//
// On Android, Chromium-based browsers (Chrome, Brave, …) don't open the file
// picker directly: they open a chooser that also offers a capture app for every
// media category the `accept` list mentions. `.mid`/`.midi` (and `audio/midi`)
// resolve to an `audio/` MIME type there, so the chooser adds the sound
// recorder ("Files or Recorder?") — an extra tap, and never what anyone wants.
// See `showExternalPicker` in Chromium's
// ui/android/java/src/org/chromium/ui/base/SelectFileDialog.java.
//
// So on Android the attribute names only `application/octet-stream`: it isn't
// an image, video or audio type, so no capture app is offered and the chooser
// goes straight to the file picker, and because it is the generic type Chromium
// doesn't filter the picker at all, so MIDI and MusicXML files stay selectable.
// Leaving `accept` off instead would do the opposite: no type counts as "any
// type", which offers the camera, camcorder and recorder all at once.
// `loadFile` routes by extension, so nothing relies on the picker's filtering.

const SCORE_FILE_ACCEPT =
  ".mid,.midi,audio/midi,.musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml";

const ANDROID_SCORE_FILE_ACCEPT = "application/octet-stream";

export function scoreFileAccept(userAgent: string): string {
  return /Android/i.test(userAgent)
    ? ANDROID_SCORE_FILE_ACCEPT
    : SCORE_FILE_ACCEPT;
}
