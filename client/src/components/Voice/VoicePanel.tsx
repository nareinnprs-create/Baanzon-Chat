import { useCallback } from 'react';
import { CircleSlash2, Waves } from 'lucide-react';
import { Alert, Button, EmptyState, Spinner } from '@librechat/client';
import type { ReactNode } from 'react';
import type { VoiceHistoryTurn, VoiceOptions, VoiceStatus, VoiceTranscriptRole } from './types';
import { useAuthToken } from '~/hooks/AuthContext';
import useDiyaVoice from '~/hooks/useDiyaVoice';
import { VOICE_LABELS as L } from './labels';
import { requestDiyaTurn } from './api';
import { cn } from '~/utils';
import Orb from './Orb';

export interface VoicePanelProps extends VoiceOptions {
  title?: string;
  className?: string;
}

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: L.statusIdle,
  connecting: L.statusConnecting,
  listening: L.statusListening,
  thinking: L.statusThinking,
  speaking: L.statusSpeaking,
  muted: L.statusMuted,
  error: L.statusError,
  unsupported: L.statusUnsupported,
};

const ROLE_LABELS: Record<VoiceTranscriptRole, string> = {
  user: L.speakerYou,
  assistant: L.speakerAssistant,
};

function statusAnnouncement(status: VoiceStatus, bargeIn: boolean): string {
  if (bargeIn) {
    return L.announceBargeIn;
  }
  if (status === 'listening') {
    return L.announceListening;
  }
  if (status === 'speaking') {
    return L.announceSpeaking;
  }
  if (status === 'muted') {
    return L.announceMuted;
  }
  if (status === 'idle') {
    return L.announceIdle;
  }
  return '';
}

/**
 * The Diya Orb session panel: status, orb, transcript, mute, barge-in and end
 * session, across explicit error and unsupported states. It owns the session
 * through {@link useDiyaVoice} and renders one branch per lifecycle status.
 * The default `turn` posts to the backend turn endpoint with the session's
 * Bearer token; the model identity stays on the server.
 */
export default function VoicePanel({
  turn,
  vad,
  tickMs,
  autoStart,
  onTranscript,
  title,
  className,
}: VoicePanelProps) {
  const token = useAuthToken();
  const defaultTurn = useCallback(
    (text: string, history: VoiceHistoryTurn[], signal: AbortSignal) =>
      requestDiyaTurn(text, history, signal, token ?? undefined),
    [token],
  );

  const voice = useDiyaVoice({
    turn: turn ?? defaultTurn,
    vad,
    tickMs,
    autoStart,
    onTranscript,
  });

  const { status } = voice;
  const active =
    status === 'connecting' ||
    status === 'listening' ||
    status === 'thinking' ||
    status === 'speaking' ||
    status === 'muted';

  let body: ReactNode = null;
  if (status === 'unsupported') {
    body = (
      <div data-testid="voice-unsupported">
        <EmptyState
          icon={CircleSlash2}
          title={L.unsupportedTitle}
          description={L.unsupportedDescription}
        />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-text-secondary"
          data-testid="voice-status"
        >
          {status === 'connecting' || status === 'thinking' ? (
            <Spinner className="size-4" aria-hidden="true" />
          ) : (
            <Waves className="size-4" aria-hidden="true" />
          )}
          {STATUS_LABELS[status]}
          <span className="sr-only">{statusAnnouncement(status, voice.bargeIn)}</span>
        </p>

        {voice.error != null ? (
          <Alert variant="error" data-testid="voice-error">
            <div className="flex flex-col gap-2">
              <span className="font-medium">{L.errorTitle}</span>
              <span>{voice.error}</span>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void voice.start()}
                >
                  {L.retry}
                </Button>
              </div>
            </div>
          </Alert>
        ) : null}

        {voice.bargeIn ? (
          <p role="status" className="text-xs font-medium text-text-primary">
            {L.bargeInActive}
          </p>
        ) : null}

        <div className="flex items-center justify-center py-2">
          <Orb status={status} micLevel={voice.micLevel} onToggle={voice.toggle} />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {active ? (
            <Button
              type="button"
              variant="outline"
              size="default"
              aria-pressed={voice.muted}
              onClick={() => voice.setMuted(!voice.muted)}
            >
              {voice.muted ? L.unmute : L.mute}
            </Button>
          ) : null}
          {status === 'speaking' || status === 'thinking' ? (
            <Button type="button" variant="outline" size="default" onClick={voice.interrupt}>
              {L.bargeIn}
            </Button>
          ) : null}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">{L.transcriptHeading}</h3>
          {voice.transcripts.length === 0 ? (
            <p className="text-sm text-text-secondary" data-testid="voice-transcript-empty">
              {L.transcriptEmpty}
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-auto">
              {voice.transcripts.map((transcript) => (
                <li key={transcript.id} className="text-sm">
                  <span className="font-medium text-text-secondary">
                    {ROLE_LABELS[transcript.role]}
                  </span>
                  <span className="ml-1 text-text-primary">{transcript.text}</span>
                  {transcript.final ? null : (
                    <span className="ml-1 text-text-secondary" aria-hidden="true">
                      {'\u2026'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <section
      aria-label={title ?? L.title}
      className={cn('flex h-full min-h-0 flex-col gap-4 overflow-auto p-4', className)}
    >
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <Waves className="size-4 text-text-secondary" aria-hidden="true" />
          {title ?? L.title}
        </h2>
        <p className="text-sm text-text-secondary">{L.description}</p>
      </header>
      {body}
    </section>
  );
}
