# piano-practice

## MIDI File Inspector

Upload any `.mid` / `.midi` file to render it as scrollable sheet music. Each
track with notes gets its own staff; a checkbox row above the score lets you
show or hide individual tracks. The score scrolls horizontally — one continuous
line with no wrapping — so long pieces stay readable without layout reflow.

Clef (treble or bass) is chosen automatically per track based on the average
pitch of its notes. Notes are quantised to the nearest 16th note before
rendering.

### Library choice

Sheet music rendering uses [VexFlow 5](https://github.com/0xfe/vexflow) (MIT).
MIDI parsing uses [@tonejs/midi](https://github.com/Tonejs/Midi) (MIT) rather
than the lower-level `midi-file` package because it resolves the note-on/off
pairing, delta-time accumulation, and tempo-change arithmetic that `midi-file`
leaves to the caller — delivering ready-to-use note objects with absolute tick
positions and durations.

## Bluetooth Piano Input

The app can receive live MIDI notes from a Bluetooth-connected electric piano using the
Web Bluetooth API. This works in Chrome-based browsers on Android (including Brave with
one extra setup step).

### Setup

**1. Pair your piano with your Android phone**

Do this before opening the app:

1. Put your piano into Bluetooth pairing mode. Check your piano's manual — it's usually
   done by holding a dedicated Bluetooth button until an indicator light flashes.
2. On Android, go to **Settings → Connected devices → Pair new device**.
3. Select your piano from the list. Most BLE MIDI devices pair without a PIN.

**2. Enable Web Bluetooth in Brave** (one-time, Brave only)

Web Bluetooth is disabled by default in Brave for privacy reasons:

1. In Brave, navigate to `brave://flags`.
2. Search for `enable-experimental-web-platform-features`.
3. Set it to **Enabled**.
4. Tap **Relaunch** at the bottom of the screen.

Chrome on Android does not require this step.

**3. Connect from the app**

1. Open the app in Brave (or Chrome) on your Android phone.
2. Scroll to the **Live Piano Input** section and tap **Connect Piano**.
3. A browser device picker will appear — select your piano from the list.
4. Once connected, press keys on the piano. Each key press and release will appear in the
   log table showing the note name, whether it was pressed or released, and how hard it
   was pressed (velocity).

### How it works

The app uses the [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
to connect directly to the piano's BLE MIDI GATT service
(UUID `03b80e5a-ede8-4b33-a751-6ce34ec4c700`) and subscribes to characteristic
notifications. Incoming BLE MIDI packets are parsed to extract Note On and Note Off
messages, which are displayed in a scrolling log (up to 200 entries).
