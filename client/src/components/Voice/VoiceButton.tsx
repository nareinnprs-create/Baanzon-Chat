import { Mic, Square } from 'lucide-react';
import { Button } from '@librechat/client';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { VoiceStatus } from './types';
import { VOICE_LABELS as L } from './labels';
import { cn } from '~/utils';

export interface VoiceButtonProps {
  status: VoiceStatus;
  /** `toggle` starts/stops on click; `push-to-talk` runs only while held. */
  mode?: 'toggle' | 'push-to-talk';
  disabled?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onToggle?: () => void;
  className?: string;
}

const ACTIVE_STATUSES: readonly VoiceStatus[] = ['connecting', 'listening', 'speaking', 'muted'];

function isActive(status: VoiceStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * The microphone control. A toggle starts and ends the session on click; a
 * push-to-talk button runs it only while held, from pointer or keyboard. Both
 * expose the live status through an accessible label and `aria-pressed`.
 */
export default function VoiceButton({
  status,
  mode = 'toggle',
  disabled = false,
  onStart,
  onStop,
  onToggle,
  className,
}: VoiceButtonProps) {
  const active = isActive(status);
  const isDisabled = disabled || status === 'unsupported';

  if (mode === 'push-to-talk') {
    const release = () => {
      if (active) {
        onStop?.();
      }
    };
    return (
      <Button
        type="button"
        variant={active ? 'secondary' : 'default'}
        size="default"
        disabled={isDisabled}
        aria-label={active ? L.releaseToStop : L.pressToTalk}
        aria-pressed={active}
        className={cn('gap-2', className)}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          event.preventDefault();
          onStart?.();
        }}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.repeat) {
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onStart?.();
          }
        }}
        onKeyUp={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            release();
          }
        }}
      >
        <Mic className="size-4" aria-hidden="true" />
        {L.pressToTalk}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'default'}
      size="default"
      disabled={isDisabled}
      aria-label={active ? L.stop : L.start}
      aria-pressed={active}
      className={cn('gap-2', className)}
      onClick={() => onToggle?.()}
    >
      {active ? (
        <Square className="size-3.5" aria-hidden="true" />
      ) : (
        <Mic className="size-4" aria-hidden="true" />
      )}
      {active ? L.stop : L.start}
    </Button>
  );
}
