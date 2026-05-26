/**
 * Page init script that installs a fake `navigator.bluetooth` implementation,
 * so the App's `useBluetooth` hook auto-reconnects to a fake device on mount
 * and reaches `status: "connected"` — which is what gates Wait and Playalong
 * modes from being switchable.
 *
 * Once installed, `window.__sendBleMidi(bytes)` dispatches a raw BLE-MIDI
 * packet through the same `characteristicvaluechanged` listener real hardware
 * would fire, so the test exercises the full parse + dispatch pipeline.
 *
 * Must be installed via page.addInitScript() before page.goto().
 */
export function bluetoothMockInitScript(deviceName = "Mock Piano"): string {
  return `(${bluetoothMockBody.toString()})(${JSON.stringify(deviceName)});`;
}

function bluetoothMockBody(deviceName: string) {
  type Listener = (event: { target: { value: DataView } }) => void;
  const listeners: Listener[] = [];

  const fakeCharacteristic = {
    startNotifications() {
      return Promise.resolve(fakeCharacteristic);
    },
    addEventListener(type: string, fn: Listener) {
      if (type === "characteristicvaluechanged") {
        listeners.push(fn);
      }
    },
    writeValueWithoutResponse(_data: ArrayBufferView) {
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

  // biome-ignore lint/suspicious/noExplicitAny: window augmentation for tests
  const w = window as any;
  w.__sendBleMidi = (bytes: number[]) => {
    const buf = new Uint8Array(bytes).buffer;
    const view = new DataView(buf);
    for (const fn of listeners) {
      fn({ target: { value: view } });
    }
  };
  w.__bleListenerCount = () => listeners.length;
}
