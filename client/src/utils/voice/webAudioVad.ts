/**
 * WebAudio adapter for the pure voice-activity detector.
 *
 * `createWebAudioVadSampler` wires a `MediaStream` into an `AudioContext` and
 * exposes an {@link AudioLevelSampler} that reports the root-mean-square of the
 * current time-domain buffer. It returns `null` — never throws — when the
 * `AudioContext` API is missing (jsdom, insecure origins, older webviews), so a
 * caller can degrade to a session without local VAD.
 */

import type { AudioLevelSampler } from './vad';

type AudioContextConstructor = new () => AudioContext;

/** `webkitAudioContext` is still the only spelling on some Safari builds. */
function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof AudioContext !== 'undefined') {
    return AudioContext as unknown as AudioContextConstructor;
  }
  const legacy = (globalThis as { webkitAudioContext?: AudioContextConstructor })
    .webkitAudioContext;
  return legacy ?? null;
}

/** A running sampler plus the handle needed to release its audio graph. */
export interface WebAudioVadHandle {
  sampler: AudioLevelSampler;
  close(): void;
}

/**
 * Adapts a microphone stream into a level sampler, or `null` when WebAudio is
 * unavailable or the graph cannot be built. The returned handle owns the
 * `AudioContext` and must be closed to release it.
 */
export function createWebAudioVadSampler(stream: MediaStream): WebAudioVadHandle | null {
  const AudioContextCtor = getAudioContextConstructor();
  if (AudioContextCtor == null) {
    return null;
  }

  let context: AudioContext;
  try {
    context = new AudioContextCtor();
  } catch {
    return null;
  }

  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const buffer = new Float32Array(analyser.fftSize);

  let source: MediaStreamAudioSourceNode;
  try {
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
  } catch {
    void context.close().catch(() => undefined);
    return null;
  }

  const sampler: AudioLevelSampler = {
    sample(): number {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let index = 0; index < buffer.length; index += 1) {
        sum += buffer[index] * buffer[index];
      }
      return Math.sqrt(sum / buffer.length);
    },
    dispose(): void {
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* The graph may already be torn down; nothing to release. */
      }
      void context.close().catch(() => undefined);
    },
  };

  return { sampler, close: () => sampler.dispose() };
}
