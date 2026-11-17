/**
 * Mobile audio unlock. Browsers suspend AudioContexts created outside a user
 * gesture — iOS Safari always; some Android flows too. A context created after
 * the voice session's async chain (socket handshake, getUserMedia, worklet
 * loads) is far outside the tap that opened the overlay, so its output stays
 * silent forever: text replies arrive, no speech is heard.
 *
 * The mic toggle calls `primeAudio()` synchronously inside the click gesture;
 * the realtime hook adopts the primed pair via `adoptPrimedContexts()`. iOS
 * additionally needs a real buffer start inside the gesture to unlock output.
 */

let primed: { capture: AudioContext; playback: AudioContext } | null = null;

function createContext(sampleRate: number): AudioContext {
  const ctx = new AudioContext({ sampleRate });
  void ctx.resume().catch(() => undefined);
  // iOS: starting (even silence) inside the gesture is what unlocks output.
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  src.start();
  src.disconnect();
  return ctx;
}

/** Call synchronously inside the gesture that opens the voice overlay. */
export function primeAudio(captureRate: number, playbackRate: number): void {
  if (primed) {
    return;
  }
  try {
    primed = {
      capture: createContext(captureRate),
      playback: createContext(playbackRate),
    };
  } catch {
    primed = null;
  }
}

/**
 * Hands the primed pair to the session and clears the holder so the next
 * gesture primes fresh contexts. Without a primed pair (e.g. the overlay was
 * opened programmatically) it falls back to new contexts, which on mobile may
 * stay suspended until the session's own gesture-resume fallback runs.
 */
export function adoptPrimedContexts(
  captureRate: number,
  playbackRate: number,
): { capture: AudioContext; playback: AudioContext } {
  const pair = primed;
  primed = null;
  if (pair) {
    void pair.capture.resume().catch(() => undefined);
    void pair.playback.resume().catch(() => undefined);
    return pair;
  }
  return { capture: createContext(captureRate), playback: createContext(playbackRate) };
}
