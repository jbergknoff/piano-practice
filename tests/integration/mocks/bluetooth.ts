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
export function bluetoothMockInitScript(
  deviceName = "Mock Piano",
  options: {
    /** Whether getDevices() reports a previously-authorized device, i.e.
     * whether the mount-time auto-reconnect finds anything. */
    autoConnect?: boolean;
    /** When set, requestDevice() rejects with this message instead of
     * resolving — e.g. to simulate the user dismissing the device picker. */
    requestDeviceError?: string;
  } = {},
): string {
  const config = {
    autoConnect: options.autoConnect ?? true,
    requestDeviceError: options.requestDeviceError ?? null,
  };
  return `(${bluetoothMockBody.toString()})(${JSON.stringify(deviceName)}, ${JSON.stringify(config)});`;
}

function bluetoothMockBody(
  deviceName: string,
  config: { autoConnect: boolean; requestDeviceError: string | null },
) {
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

  let requestDeviceCount = 0;
  const fakeBluetooth = {
    getDevices() {
      return Promise.resolve(config.autoConnect ? [fakeDevice] : []);
    },
    requestDevice() {
      requestDeviceCount += 1;
      if (config.requestDeviceError !== null) {
        return Promise.reject(new Error(config.requestDeviceError));
      }
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
  w.__bleRequestDeviceCount = () => requestDeviceCount;
}
