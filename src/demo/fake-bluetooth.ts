/**
 * Demo mode: a desktop-only profiling harness, activated by the `?demo=1` URL
 * query parameter. It installs an inert fake `navigator.bluetooth` so the app
 * reaches `status: "connected"` without real hardware (which makes Playalong
 * selectable and gives count-in's `bluetooth.sendNote` a target). The simulated
 * key presses themselves are NOT fed through this adapter — PracticeScreen's
 * demo feeder drives the App-owned note-event dispatch ref directly, which is
 * the exact path real BLE input ends up calling, so a captured performance
 * profile reflects production rendering.
 *
 * This mirrors the integration-test mock in tests/integration/mocks/bluetooth.ts,
 * but that one is injected as a stringified init script in a separate browser
 * context, so the two intentionally stay separate.
 */

export function isDemoMode(): boolean {
  if (typeof location === "undefined") {
    return false;
  }
  return new URLSearchParams(location.search).has("demo");
}

/**
 * Optional `?demo=1&from=105&to=114` focus range, so a profile can target a
 * specific (e.g. dense) section of a piece. Playalong loops within the focus
 * range, giving a steady, representative rendering load. Returns null when the
 * params are absent or invalid.
 */
export function demoFocusRange(): { from: number; to: number } | null {
  if (typeof location === "undefined") {
    return null;
  }
  const params = new URLSearchParams(location.search);
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to < from
  ) {
    return null;
  }
  return { from, to };
}

export function installFakeBluetooth(deviceName = "Demo Piano"): void {
  if (typeof navigator === "undefined") {
    return;
  }

  const fakeCharacteristic = {
    startNotifications() {
      return Promise.resolve(fakeCharacteristic);
    },
    addEventListener() {},
    writeValueWithoutResponse() {
      return Promise.resolve();
    },
  };

  const fakeService = {
    getCharacteristic() {
      return Promise.resolve(fakeCharacteristic);
    },
  };

  const fakeServer = {
    getPrimaryService() {
      return Promise.resolve(fakeService);
    },
  };

  const fakeDevice = {
    name: deviceName,
    gatt: {
      connect() {
        return Promise.resolve(fakeServer);
      },
    },
    addEventListener() {},
  };

  const fakeBluetooth = {
    getDevices() {
      return Promise.resolve([fakeDevice]);
    },
    requestDevice() {
      return Promise.resolve(fakeDevice);
    },
  };

  Object.defineProperty(navigator, "bluetooth", {
    value: fakeBluetooth,
    configurable: true,
  });
}
