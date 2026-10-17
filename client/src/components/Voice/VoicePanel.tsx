import { CircleSlash2, Waves } from 'lucide-react';
import { Alert, Button, EmptyState, Spinner } from '@librechat/client';
import type { ReactNode } from 'react';
import type { VoiceOptions, VoiceStatus, VoiceTranscriptRole } from './types';
import useRealtimeVoice from '~/hooks/useRealtimeVoice';
import { VOICE_LABELS as L } from './labels';
import VoiceButton from './VoiceButton';
import { cn } from '~/utils';

export interface VoicePanelProps extends VoiceOptions {
  /** Control style for the microphone button. Default `toggle`. */
  mode?: 'toggle' | 'push-to-talk';
  title?: string;
  className?: string;
}

const STATUS_LABELS: Record<VoiceStatus, string> = {
  idle: L.statusIdle,
  connecting: L.statusConnecting,
  listening: L.statusListening,
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
  if (status === 'connecting') {
    return L.announceConnecting;
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

function MicMeter({ level }: { level: number }) {
  const percent = Math.round(Math.min(Math.max(level, 0), 1) * 100);
  return (
    <div
      role="meter"
      aria-label={L.micLevel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-tertiary"
    >
      <div
        className="h-full rounded-full bg-series-1 transition-[width] duration-100 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * The realtime-voice session panel: status, microphone level, transcript, mute,
 * barge-in and end-call, across explicit loading, empty, error and unsupported
 * states. It owns the session through {@link useRealtimeVoice} and renders one
 * branch per lifecycle status.
 */
export default function VoicePanel({
  transport,
  createTransport,
  rtcConfig,
  vad,
  tickMs,
  autoStart,
  onTranscript,
  mode = 'toggle',
  title,
  className,
}: VoicePanelProps) {
  const voice = useRealtimeVoice({
    transport,
    createTransport,
    rtcConfig,
    vad,
    tickMs,
    autoStart,
    onTranscript,
  });

  const { status } = voice;
  const active =
    status === 'connecting' ||
    status === 'listening' ||
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
          {status === 'connecting' ? (
            <Spinner className="size-4" aria-hidden="true" />
          ) : (
            <Waves className="size-4" aria-hidden="true" />
          )}
          {STATUS_LABELS[status]}
          <span className="sr-only">{statusAnnouncement(status, voice.bargeIn)}</span>
        </p>

        {status === 'error' ? (
          <Alert variant="error" data-testid="voice-error">
            <div className="flex flex-col gap-2">
              <span className="font-medium">{L.errorTitle}</span>
              <span>{voice.error ?? L.errorDescription}</span>
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

        {active && status !== 'connecting' ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border-light bg-surface-secondary p-4">
            {voice.muted ? (
              <p className="text-xs text-text-secondary">{L.statusMuted}</p>
            ) : (
              <MicMeter level={voice.micLevel} />
            )}
            {voice.bargeIn ? (
              <p role="status" className="text-xs font-medium text-text-primary">
                {L.bargeInActive}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <VoiceButton
            status={status}
            mode={mode}
            onToggle={voice.toggle}
            onStart={() => void voice.start()}
            onStop={voice.stop}
          />
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
          {status === 'speaking' ? (
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
