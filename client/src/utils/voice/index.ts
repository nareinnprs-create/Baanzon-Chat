/**
 * Realtime-voice utilities (P5.2): a pure voice-activity detector, its WebAudio
 * adapter, and the native WebRTC transport. All browser globals are guarded so
 * the modules are import-safe under jsdom.
 */

export { createVoiceActivityDetector } from './vad';
export { createWebAudioVadSampler } from './webAudioVad';
export { createWebRtcTransport, isRealtimeVoiceSupported, isVoiceVadSupported } from './transport';
export type {
  AudioLevelSampler,
  VadOptions,
  VoiceActivityDetector,
  VoiceActivityEvent,
  VoiceActivitySnapshot,
  VoiceActivityState,
} from './vad';
export type { WebAudioVadHandle } from './webAudioVad';
export type { WebRtcTransportOptions } from './transport';
