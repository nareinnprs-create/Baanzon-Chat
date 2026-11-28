/**
 * Audio output for Diya.
 *
 * Web Audio is the primary path: an `AudioBufferSourceNode` is NOT silenced by
 * the iOS ringer switch, while an `<audio>` element is. It also gives each
 * sentence its own source, so overlapping replies cannot swap a shared `src`
 * out from under each other.
 *
 * `primeOutput()` must run inside a user gesture: iOS starts the context
 * suspended and refuses to resume it later, and Android PWAs refuse the first
 * `play()` that is not gesture-adjacent.
 */
type AudioContextCtor = new () => AudioContext;

function contextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let shared: AudioContext | null = null;
let unlocked = false;
let silentUrl: string | null = null;

/** One context for the whole page; created lazily and reused. */
export function getPlaybackContext(): AudioContext | null {
  if (shared != null) {
    return shared;
  }
  const Ctor = contextCtor();
  if (Ctor == null) {
    return null;
  }
  try {
    shared = new Ctor();
    return shared;
  } catch {
    return null;
  }
}

/** 100ms of silence, used to unlock the context inside a gesture. */
function silentWavUrl(): string {
  if (silentUrl != null) {
    return silentUrl;
  }
  const sampleRate = 8000;
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  return silentUrl;
}

let fallbackPlayer: HTMLAudioElement | null = null;

/** Must be called synchronously from a click/tap handler. */
export function primeOutput(): void {
  const ctx = getPlaybackContext();
  if (ctx != null) {
    void ctx.resume?.().catch(() => undefined);
    if (!unlocked) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = ctx.createBuffer(1, 1, 22050);
        source.connect(ctx.destination);
        source.start(0);
        unlocked = true;
      } catch {
        /* the next real buffer will try again */
      }
    }
  }
  // Element unlock for browsers without Web Audio, and as a second signal for
  // iOS where a suspended element blocks later playback.
  if (fallbackPlayer == null && typeof Audio !== 'undefined') {
    try {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.muted = true;
      audio.src = silentWavUrl();
      void audio
        .play()
        .then(() => {
          audio.pause();
          audio.removeAttribute('src');
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
      fallbackPlayer = audio;
    } catch {
      /* no element support; Web Audio or nothing */
    }
  }
}

export function getFallbackPlayer(): HTMLAudioElement | null {
  return fallbackPlayer;
}

export interface PlayingBuffer {
  /** Resolves when playback ends, errors, or is stopped. */
  done: Promise<void>;
  stop: () => void;
}

/** Plays a decoded buffer; null when Web Audio is unavailable. */
export function playBuffer(buffer: AudioBuffer, playbackRate = 1): PlayingBuffer | null {
  const ctx = getPlaybackContext();
  if (ctx == null) {
    return null;
  }
  let settle: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (playbackRate > 0 && playbackRate !== 1) {
    source.playbackRate.value = playbackRate;
  }
  source.connect(ctx.destination);
  const finish = () => {
    if (settle != null) {
      const resolve = settle;
      settle = null;
      resolve();
    }
  };
  source.onended = finish;
  try {
    if (ctx.state === 'suspended') {
      void ctx.resume?.().catch(() => undefined);
    }
    source.start(0);
  } catch {
    finish();
  }
  return {
    done,
    stop: () => {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      finish();
    },
  };
}
