/**
 * Voice utilities for Diya Orb: a pure voice-activity detector, its WebAudio
 * adapter, and the Web Speech adapters for the in-browser session loop. All
 * browser globals are guarded so the modules are import-safe under jsdom.
 */

export { createVoiceActivityDetector } from './vad';
export { createWebAudioVadSampler } from './webAudioVad';
export { createRecognizer, isDiyaVoiceSupported, pickAssistantVoice } from './speech';
export type {
  AudioLevelSampler,
  VadOptions,
  VoiceActivityDetector,
  VoiceActivityEvent,
  VoiceActivitySnapshot,
  VoiceActivityState,
} from './vad';
export type { WebAudioVadHandle } from './webAudioVad';
export type {
  SpeechRecognitionAlternativeLike,
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from './speech';
