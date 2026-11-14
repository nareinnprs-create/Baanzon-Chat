import type { CSSProperties } from 'react';
import type { VoiceStatus } from './types';
import { VOICE_LABELS as L } from './labels';
import { cn } from '~/utils';

export interface OrbProps {
  status: VoiceStatus;
  disabled?: boolean;
  /** Latest microphone amplitude in 0..1, pulsing the core while listening. */
  micLevel?: number;
  onToggle?: () => void;
  className?: string;
}

const ACTIVE_STATUSES: readonly VoiceStatus[] = [
  'connecting',
  'listening',
  'thinking',
  'speaking',
  'muted',
];

function isActive(status: VoiceStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * The Diya Orb control: one round button that starts and ends the session.
 * Its visual state follows the session status through the `.diya-orb` classes
 * (defined in `style.css` because the layered halo/ring animation cannot be
 * expressed with the shared Tailwind primitives), and the live status is
 * exposed through an accessible label and `aria-pressed`.
 */
export default function Orb({ status, disabled, micLevel = 0, onToggle, className }: OrbProps) {
  const active = isActive(status);
  const level = Math.round(Math.min(Math.max(micLevel, 0), 1) * 100);

  return (
    <button
      type="button"
      className={cn('diya-orb', `diya-orb--${status}`, active && 'diya-orb--active', className)}
      aria-label={active ? L.stop : L.start}
      aria-pressed={active}
      disabled={disabled || status === 'unsupported'}
      onClick={() => onToggle?.()}
      style={{ '--diya-level': level / 100 } as CSSProperties}
      data-testid="diya-orb"
    >
      <span className="diya-orb__halo" aria-hidden="true" />
      <span className="diya-orb__ring" aria-hidden="true" />
      <span className="diya-orb__core" aria-hidden="true" />
    </button>
  );
}
