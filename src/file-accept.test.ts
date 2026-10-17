import { describe, expect, test } from "bun:test";
import { scoreFileAccept } from "./file-accept";

const ANDROID_BRAVE =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("scoreFileAccept", () => {
  test("names no audio, image or video type on Android, so no capture app is offered", () => {
    const accept = scoreFileAccept(ANDROID_BRAVE);
    expect(accept).not.toMatch(/audio|image|video|\.midi?\b/);
    expect(accept).toBe("application/octet-stream");
  });

  test("filters to score files everywhere else", () => {
    for (const userAgent of [DESKTOP_CHROME, IPHONE_SAFARI]) {
      const accept = scoreFileAccept(userAgent).split(",");
      expect(accept).toContain(".mid");
      expect(accept).toContain(".mxl");
      expect(accept).toContain(".musicxml");
    }
  });
});
