/**
 * @jest-environment jsdom
 */
/** primeAudio holds module state, so every test gets a fresh module. */
let mod: typeof import('./primeAudio');

class FakeContext {
  static created = 0;
  state = 'suspended';
  sampleRate: number;
  resume: jest.Mock<Promise<void>, []>;
  constructor(options: { sampleRate: number }) {
    FakeContext.created++;
    this.sampleRate = options.sampleRate;
    this.resume = jest.fn(async () => {
      this.state = 'running';
    });
  }

  createBuffer(): Record<string, never> {
    return {};
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: jest.fn(),
      start: jest.fn(),
      disconnect: jest.fn(),
    };
  }
}

beforeEach(() => {
  jest.resetModules();
  mod = jest.requireActual('./primeAudio');
  (window as unknown as { AudioContext: typeof FakeContext }).AudioContext = FakeContext;
  FakeContext.created = 0;
});

describe('primeAudio', () => {
  it('primes inside the gesture and hands the same pair to the session', () => {
    mod.primeAudio(16000, 24000);
    const first = mod.adoptPrimedContexts(16000, 24000);
    expect(first.capture.sampleRate).toBe(16000);
    expect(first.playback.sampleRate).toBe(24000);
    expect(first.capture.resume).toHaveBeenCalled();
    expect(first.playback.resume).toHaveBeenCalled();
    // The holder cleared: the next gesture primes a fresh pair.
    const second = mod.adoptPrimedContexts(16000, 24000);
    expect(second.capture).not.toBe(first.capture);
    expect(FakeContext.created).toBe(4);
  });

  it('is idempotent while the pair is unclaimed', () => {
    mod.primeAudio(16000, 24000);
    mod.primeAudio(16000, 24000);
    mod.adoptPrimedContexts(16000, 24000);
    expect(FakeContext.created).toBe(2);
  });

  it('falls back to fresh contexts when nothing was primed', () => {
    const pair = mod.adoptPrimedContexts(16000, 24000);
    expect(pair.capture.sampleRate).toBe(16000);
    expect(pair.playback.sampleRate).toBe(24000);
    expect(pair.capture.resume).toHaveBeenCalled();
  });

  it('survives a broken AudioContext and still falls back later', () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        throw new Error('unsupported sampleRate');
      }
    };
    expect(() => mod.primeAudio(16000, 24000)).not.toThrow();
    // Fallback throws too here — the session hook's own catch handles it.
    expect(() => mod.adoptPrimedContexts(16000, 24000)).toThrow();
  });
});
