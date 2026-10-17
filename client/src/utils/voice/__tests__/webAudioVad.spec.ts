import type { WebAudioVadHandle } from '../webAudioVad';
import { createWebAudioVadSampler } from '../webAudioVad';

class FakeAnalyser {
  fftSize = 0;
  readonly getFloatTimeDomainData = jest.fn((buffer: Float32Array) => {
    buffer.fill(0.5);
  });

  readonly disconnect = jest.fn();
}

class FakeSource {
  readonly connect = jest.fn();
  readonly disconnect = jest.fn();
}

class FakeAudioContext {
  readonly analyser = new FakeAnalyser();
  readonly source = new FakeSource();
  readonly close = jest.fn(async () => undefined);
  readonly createAnalyser = jest.fn(() => this.analyser);
  readonly createMediaStreamSource = jest.fn((_stream: MediaStream) => this.source);
}

class FailingSourceContext {
  readonly close = jest.fn(async () => undefined);
  readonly createAnalyser = jest.fn(() => new FakeAnalyser());
  readonly createMediaStreamSource = jest.fn(() => {
    throw new Error('bad stream');
  });
}

class ThrowingContext {
  constructor() {
    throw new Error('WebAudio blocked');
  }
}

const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
const originalWebkit = Object.getOwnPropertyDescriptor(globalThis, 'webkitAudioContext');

function setGlobal(name: 'AudioContext' | 'webkitAudioContext', value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function restoreGlobals(): void {
  if (originalAudioContext != null) {
    Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
  } else {
    Reflect.deleteProperty(globalThis, 'AudioContext');
  }
  if (originalWebkit != null) {
    Object.defineProperty(globalThis, 'webkitAudioContext', originalWebkit);
  } else {
    Reflect.deleteProperty(globalThis, 'webkitAudioContext');
  }
}

function requireHandle(handle: WebAudioVadHandle | null): WebAudioVadHandle {
  if (handle == null) {
    throw new Error('expected a sampler handle');
  }
  return handle;
}

function fakeStream(): MediaStream {
  return {
    getAudioTracks: () => [],
    getTracks: () => [],
  } as unknown as MediaStream;
}

describe('createWebAudioVadSampler', () => {
  afterEach(restoreGlobals);

  it('returns null when WebAudio is unavailable', () => {
    expect(createWebAudioVadSampler(fakeStream())).toBeNull();
  });

  it('returns null when the AudioContext constructor throws', () => {
    setGlobal('AudioContext', ThrowingContext);
    expect(createWebAudioVadSampler(fakeStream())).toBeNull();
  });

  it('returns null and closes the context when the source graph cannot be built', () => {
    const closed = { calls: [] as unknown[] };
    class CapturingFailingContext extends FailingSourceContext {
      constructor() {
        super();
        closed.calls.push(this.close);
      }
    }
    setGlobal('AudioContext', CapturingFailingContext);

    expect(createWebAudioVadSampler(fakeStream())).toBeNull();
    expect(closed.calls).toHaveLength(1);
  });

  it('falls back to the webkit-prefixed constructor', () => {
    setGlobal('webkitAudioContext', FakeAudioContext);

    const handle = requireHandle(createWebAudioVadSampler(fakeStream()));

    expect(handle.sampler.sample()).toBeCloseTo(0.5);
    handle.close();
  });

  it('samples the root mean square of the time-domain buffer', () => {
    setGlobal('AudioContext', FakeAudioContext);

    const handle = requireHandle(createWebAudioVadSampler(fakeStream()));

    expect(handle.sampler.sample()).toBeCloseTo(0.5);
  });

  it('releases the audio graph on dispose and is safe to dispose twice', () => {
    const released = { disconnects: 0, closes: 0 };
    class TrackingContext extends FakeAudioContext {
      constructor() {
        super();
        this.source.disconnect.mockImplementation(() => {
          released.disconnects += 1;
        });
        this.analyser.disconnect.mockImplementation(() => {
          released.disconnects += 1;
        });
        this.close.mockImplementation(async () => {
          released.closes += 1;
        });
      }
    }
    setGlobal('AudioContext', TrackingContext);

    const handle = requireHandle(createWebAudioVadSampler(fakeStream()));
    handle.sampler.dispose();

    expect(released.disconnects).toBe(2);
    expect(released.closes).toBeGreaterThanOrEqual(1);
    expect(() => handle.close()).not.toThrow();
  });
});
