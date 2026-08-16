/**
 * Page init script that installs a fake `navigator.requestMIDIAccess` plus a
 * `navigator.permissions.query({ name: "midi" })` result, so tests can drive
 * `useWebMidi`'s silent auto-reconnect.
 *
 * The permission state is the interesting knob: the hook only auto-attaches
 * when the origin *already* holds the MIDI permission, which is what keeps it
 * from triggering a permission prompt on page load. Pass `"prompt"` to assert
 * that nothing connects by itself.
 *
 * Once attached, `window.__sendWebMidi(bytes)` dispatches a raw MIDI message
 * through the port's `onmidimessage` handler, the same way real hardware would.
 *
 * Must be installed via page.addInitScript() before page.goto().
 */
export function webMidiMockInitScript(
  options: {
    permission?: "granted" | "prompt" | "denied";
    deviceName?: string;
  } = {},
): string {
  const config = {
    permission: options.permission ?? "granted",
    deviceName: options.deviceName ?? "Mock USB Piano",
  };
  return `(${webMidiMockBody.toString()})(${JSON.stringify(config)});`;
}

function webMidiMockBody(config: { permission: string; deviceName: string }) {
  const input = {
    name: config.deviceName,
    state: "connected",
    onmidimessage: null as null | ((event: { data: Uint8Array }) => void),
  };
  const access = {
    inputs: new Map([["mock-input", input]]),
    outputs: new Map(),
    onstatechange: null,
  };

  let requestCount = 0;
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: () => {
      requestCount += 1;
      return Promise.resolve(access);
    },
    configurable: true,
  });

  const permissions = navigator.permissions;
  const originalQuery = permissions?.query?.bind(permissions);
  if (permissions) {
    Object.defineProperty(permissions, "query", {
      value: (descriptor: { name: string }) => {
        if (descriptor?.name === "midi") {
          return Promise.resolve({ state: config.permission });
        }
        return originalQuery
          ? originalQuery(descriptor as never)
          : Promise.reject(new TypeError("unsupported permission descriptor"));
      },
      configurable: true,
    });
  }

  // biome-ignore lint/suspicious/noExplicitAny: window augmentation for tests
  const w = window as any;
  w.__sendWebMidi = (bytes: number[]) => {
    input.onmidimessage?.({ data: new Uint8Array(bytes) });
  };
  w.__webMidiRequestCount = () => requestCount;
}
