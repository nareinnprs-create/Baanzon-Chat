import { useCallback } from 'react';
import { CircleSlash2, Waves, X } from 'lucide-react';
import { Alert, Button, EmptyState, Spinner, TooltipAnchor } from '@librechat/client';
import type { ReactNode } from 'react';
import type { VoiceHistoryTurn, VoiceOptions, VoiceStatus, VoiceTranscriptRole } from './types';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useAuthToken } from '~/hooks/AuthContext';
import useDiyaVoice from '~/hooks/useDiyaVoice';
import { VOICE_LABELS as L } from './labels';
import { requestDiyaTurn } from './api';
import { cn } from '~/utils';
import Orb from './Orb';

export interface VoicePanelProps extends VoiceOptions {
  title?: string;
  className?: string;
  /** `'page'` (default) is the documented route layout; `'overlay'` is the
   *  ChatGPT-style full-screen voice mode: no header, a centered orb and a
   *  carded transcript pinned to the bottom. */
  variant?: 'page' | 'overlay';
  /** Renders the close control (overlay mode) and is called by it. */
  onClose?: () => void;
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
  variant = 'page',
  onClose,
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
    token,
  });

  const { status } = voice;
  const active =
    status === 'connecting' ||
    status === 'listening' ||
    status === 'thinking' ||
    status === 'speaking' ||
    status === 'muted';

  const overlay = variant === 'overlay';

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
      <div className={cn('flex flex-col gap-4', overlay && 'flex-1 justify-center')}>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-center gap-2 text-sm text-text-secondary',
            overlay && 'justify-center',
          )}
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

        <div className={cn('flex items-center justify-center py-2', overlay && 'py-8')}>
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

        <section
          className={cn(
            'flex flex-col gap-2',
            overlay && 'rounded-xl border border-border-light bg-surface-secondary-alt p-3',
          )}
        >
          <h3 className={cn('text-sm font-semibold text-text-primary', overlay && 'sr-only')}>
            {L.transcriptHeading}
          </h3>
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
      className={cn(
        'flex h-full min-h-0 flex-col gap-4 overflow-auto p-4',
        overlay &&
          'relative overflow-hidden bg-gradient-to-b from-surface-primary to-surface-secondary',
        className,
      )}
    >
      {overlay ? (
        onClose && (
          <TooltipAnchor
            description={L.close}
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={L.close}
                data-testid="voice-close-button"
                onClick={onClose}
                className="absolute right-3 top-3 z-10 rounded-full"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        )
      ) : (
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2 md:hidden">
            {/* The voice route renders no chat header; without this the
                drawer is unreachable on narrow screens. */}
            <OpenSidebar testId="voice-open-sidebar-button" />
          </div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <Waves className="size-4 text-text-secondary" aria-hidden="true" />
            {title ?? L.title}
          </h2>
          <p className="text-sm text-text-secondary">{L.description}</p>
        </header>
      )}
      {body}
    </section>
  );
}
