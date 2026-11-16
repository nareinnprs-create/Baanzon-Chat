import { useCallback } from 'react';
import { Mic } from 'lucide-react';
import { Alert, Button } from '@librechat/client';
import { Provider, createStore, useAtomValue, useAtom } from 'jotai';
import {
  voiceCaptionsAtom,
  voiceErrorAtom,
  voiceMicLevelAtom,
  voiceMutedAtom,
  voiceRealtimeOpenAtom,
  voiceRemainingSecondsAtom,
  voiceSelectedVoiceAtom,
  voiceStatusAtom,
  voiceTranscriptsAtom,
  voiceVoicesAtom,
} from './atoms';
import { VOICE_LABELS as L, formatVoiceLabel } from './labels';
import { useVoiceRealtime } from '~/hooks/useVoiceRealtime';
import { cn } from '~/utils';
import Orb from './Orb';

/**
 * Realtime voice overlay: the server cascade (streaming STT → LLM → streaming
 * TTS) behind one WebSocket. Mounted by the composer mic button; the session
 * lives only while the overlay is open. Voice ids stay generic — the server
 * delivers the catalog and consumes the chosen id without naming models.
 */

const HINTS = {
  connecting: L.connectingHint,
  listening: L.listeningHint,
  speaking: L.speakingHint,
  muted: L.mutedHint,
  error: L.errorHint,
} as const;

function remainingLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return formatVoiceLabel('remaining', { time: m > 0 ? `${m}m ${s}s` : `${s}s` });
}

function SessionPanel({ onClose }: { onClose: () => void }) {
  const session = useVoiceRealtime(onClose);
  const status = useAtomValue(voiceStatusAtom);
  const micLevel = useAtomValue(voiceMicLevelAtom);
  const muted = useAtomValue(voiceMutedAtom);
  const error = useAtomValue(voiceErrorAtom);
  const transcripts = useAtomValue(voiceTranscriptsAtom);
  const voices = useAtomValue(voiceVoicesAtom);
  const remaining = useAtomValue(voiceRemainingSecondsAtom);
  const [captions, setCaptions] = useAtom(voiceCaptionsAtom);
  const [selectedVoice, setSelectedVoice] = useAtom(voiceSelectedVoiceAtom);

  const active =
    status === 'connecting' ||
    status === 'listening' ||
    status === 'thinking' ||
    status === 'speaking' ||
    status === 'muted';

  const showCaptions = captions && transcripts.length > 0;
  const lastLine = transcripts[transcripts.length - 1];
  const remainingText = remainingLabel(remaining);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="voice-realtime-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={L.title}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border-light bg-surface-primary p-6 shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-text-secondary">{remainingText}</span>
          <Button type="button" variant="ghost" size="sm" onClick={session.end}>
            {L.endSession}
          </Button>
        </div>

        <div className="flex items-center justify-center py-6">
          <Orb status={status} micLevel={micLevel} onToggle={session.end} />
        </div>

        <p
          role="status"
          aria-live="polite"
          className="text-center text-sm text-text-secondary"
          data-testid="voice-status"
        >
          {HINTS[status as keyof typeof HINTS] ?? ''}
        </p>

        {error != null ? (
          <Alert variant="error" className="mt-3" data-testid="voice-realtime-error">
            <span>{error}</span>
          </Alert>
        ) : null}

        {voices.length > 0 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <label className="text-xs text-text-secondary" htmlFor="voice-picker">
              {L.voicePicker}
            </label>
            <select
              id="voice-picker"
              value={selectedVoice ?? ''}
              onChange={(e) => {
                session.setVoice(e.target.value);
                setSelectedVoice(e.target.value);
              }}
              className="rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-sm text-text-primary"
              data-testid="voice-picker"
            >
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {showCaptions && lastLine && (
          <div className="mt-4 min-h-16 rounded-lg bg-surface-secondary p-3 text-sm">
            <span className="font-medium text-text-secondary">
              {lastLine.role === 'user' ? L.speakerYou : L.speakerAssistant}
            </span>
            <span className={cn('ml-2 text-text-primary', !lastLine.final && 'opacity-60')}>
              {lastLine.text}
            </span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-center gap-2">
          {active && (
            <Button
              type="button"
              variant="outline"
              aria-pressed={muted}
              onClick={session.toggleMuted}
            >
              {muted ? L.unmute : L.mute}
            </Button>
          )}
          <Button
            type="button"
            variant={captions ? 'default' : 'outline'}
            onClick={() => setCaptions(!captions)}
            aria-pressed={captions}
          >
            {L.captions}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {L.close}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Read in the app's default store by the composer and the overlay itself. */
export function VoiceRealtimeToggle() {
  const [open, setOpen] = useAtom(voiceRealtimeOpenAtom);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={open}
      aria-label={L.openMode}
      onClick={() => setOpen(true)}
      className={cn(open && 'text-text-primary')}
      data-testid="voice-mode-button"
    >
      <Mic className="size-4" aria-hidden="true" />
    </Button>
  );
}

/** Mount target for the composer: renders the overlay only while open. */
export function VoiceRealtimeOverlay() {
  const [open, setOpen] = useAtom(voiceRealtimeOpenAtom);
  const close = useCallback(() => setOpen(false), [setOpen]);
  if (!open) {
    return null;
  }
  return (
    <Provider store={createStore()}>
      <SessionPanel onClose={close} />
    </Provider>
  );
}
