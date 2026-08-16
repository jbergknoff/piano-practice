import { beforeEach, describe, expect, test } from "bun:test";
import { loadPreferredSource, savePreferredSource } from "./piano-preference";

beforeEach(() => {
  localStorage.clear();
});

describe("preferred piano source", () => {
  test("returns null when nothing has been saved", () => {
    expect(loadPreferredSource()).toBeNull();
  });

  test("round-trips each transport", () => {
    savePreferredSource("bluetooth");
    expect(loadPreferredSource()).toBe("bluetooth");
    savePreferredSource("midi");
    expect(loadPreferredSource()).toBe("midi");
  });

  test("ignores a stored value that isn't a known transport", () => {
    localStorage.setItem("piano-practice:preferred-source", "usb-c");
    expect(loadPreferredSource()).toBeNull();
  });
});
