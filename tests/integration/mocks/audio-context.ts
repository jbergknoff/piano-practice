/**
 * Page init script that replaces window.AudioContext with a fake whose
 * `currentTime` is driven by an internal clock — not by real wall-clock time.
 * MidiPlayer derives the cursor beat from `audioCtx.currentTime`, so this lets
 * tests advance the cursor by an exact number of beats:
 *
 *   await page.evaluate((s) => window.__advanceAudioTime(s), 1.5);
 *
 * All other AudioNode surfaces MidiPlayer touches (Oscillator, Gain,
 * BiquadFilter, AudioParam, destination) are stubbed with no-op nodes so the
 * scheduler runs cleanly without producing sound.
 *
 * Must be installed via page.addInitScript() before page.goto().
 */
export function audioContextMockInitScript(): string {
  return `(${audioContextMockBody.toString()})();`;
}

function audioContextMockBody() {
  let fakeNow = 0;

  // biome-ignore lint/suspicious/noExplicitAny: window augmentation for tests
  const w = window as any;
  w.__advanceAudioTime = (seconds: number) => {
    fakeNow += seconds;
  };
  w.__getAudioTime = () => fakeNow;
  w.__resetAudioTime = () => {
    fakeNow = 0;
  };

  class FakeAudioParam {
    value = 0;
    setValueAtTime() {
      return this;
    }
    linearRampToValueAtTime() {
      return this;
    }
    exponentialRampToValueAtTime() {
      return this;
    }
  }

  class FakeAudioNode {
    connect() {
      return this;
    }
    disconnect() {}
  }

  class FakeGainNode extends FakeAudioNode {
    gain = new FakeAudioParam();
  }

  class FakeBiquadFilter extends FakeAudioNode {
    type = "lowpass";
    frequency = new FakeAudioParam();
    Q = new FakeAudioParam();
  }

  class FakeOscillator extends FakeAudioNode {
    frequency = new FakeAudioParam();
    type = "sine";
    onended: (() => void) | null = null;
    start() {}
    stop() {}
  }

  class FakeAudioContext {
    destination = new FakeAudioNode();
    get currentTime() {
      return fakeNow;
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    createOscillator() {
      return new FakeOscillator();
    }
    createGain() {
      return new FakeGainNode();
    }
    createBiquadFilter() {
      return new FakeBiquadFilter();
    }
  }

  w.AudioContext = FakeAudioContext;
  w.webkitAudioContext = FakeAudioContext;
}
