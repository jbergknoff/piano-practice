# piano-practice

## Licenses

Sheet music notation glyphs are rendered using the [Bravura](https://github.com/steinbergmedia/bravura) font by Steinberg Media Technologies GmbH, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).

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
