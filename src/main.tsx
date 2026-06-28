import { render } from "preact";
import { App } from "./App";
import { installFakeBluetooth, isDemoMode } from "./demo/fake-bluetooth";

// Demo mode (?demo=1) installs an inert fake Bluetooth adapter before React
// mounts, so useBluetooth's auto-reconnect reaches "connected" and Playalong
// becomes selectable for desktop profiling without real hardware.
if (isDemoMode()) {
  installFakeBluetooth();
}

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
