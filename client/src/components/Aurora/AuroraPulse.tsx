import type { TAuroraPulseState } from './atoms';
import { useAuroraPulse } from './atoms';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Mark classes for the Baanzon Intelligence Pulse (blueprint §63.9), written
 * out in full because Tailwind cannot resolve interpolated class names.
 *
 * Colors are semantic theme roles only: `status-info` carries the working
 * states, `status-success` the completed state, `status-warning` needs-
 * attention — the same theme-aware roles the steering receipt chose over raw
 * palette hues so contrast holds on every canvas (identity.ts rationale).
 * Every continuous animation sits behind `motion-safe:`, so the pulse falls
 * still under `prefers-reduced-motion: reduce`.
 *
 * Motion is truthful (§63.9): `idle` and `completed` animate nothing because
 * nothing is running. The §65 Aurora gradient is deliberately absent — that
 * token set is ROADMAP milestone 2; until it lands the pulse marks state with
 * semantic roles rather than hard-coding gradient stops in a feature.
 */
const PULSE_MARKS: Record<TAuroraPulseState, string> = {
  idle: 'border border-border-medium bg-surface-tertiary',
  thinking: 'motion-safe:animate-pulse bg-status-info',
  searching: 'motion-safe:animate-pulse bg-status-info',
  reading: 'motion-safe:animate-pulse bg-status-info',
  creating: 'motion-safe:animate-pulse bg-status-info',
  voice: 'motion-safe:animate-pulse bg-status-info',
  completed: 'bg-status-success',
  attention: 'motion-safe:animate-pulse bg-status-warning',
};

/** i18n keys spelled out per state so the contract is greppable. */
const PULSE_LABEL_KEYS: Record<
  TAuroraPulseState,
  | 'com_ui_aurora_idle'
  | 'com_ui_aurora_thinking'
  | 'com_ui_aurora_searching'
  | 'com_ui_aurora_reading'
  | 'com_ui_aurora_creating'
  | 'com_ui_aurora_voice'
  | 'com_ui_aurora_completed'
  | 'com_ui_aurora_attention'
> = {
  idle: 'com_ui_aurora_idle',
  thinking: 'com_ui_aurora_thinking',
  searching: 'com_ui_aurora_searching',
  reading: 'com_ui_aurora_reading',
  creating: 'com_ui_aurora_creating',
  voice: 'com_ui_aurora_voice',
  completed: 'com_ui_aurora_completed',
  attention: 'com_ui_aurora_attention',
};

interface AuroraPulseProps {
  /** Override for host wiring; omit to read the feature-owned atom. */
  state?: TAuroraPulseState;
  /** Renders the localized state text beside the mark (still screen-reader safe). */
  withLabel?: boolean;
  className?: string;
}

/**
 * The signature Baanzon activity mark: a small state dot announcing genuine
 * system activity without exposing private chain-of-thought (§63.9).
 *
 * Blueprint mount note: §63.9 defines the state language only — it names no
 * screen position. The milestone prose (ROADMAP #3) later names the assistant
 * header + composer slot, so the component ships mount-ready (state prop or
 * the feature atom) without attaching itself anywhere; the tracker records
 * the mount as NOT-SHIPPED until a host wires real activity signals into it.
 */
export default function AuroraPulse({
  state,
  withLabel = false,
  className,
}: AuroraPulseProps): JSX.Element {
  const localize = useLocalize();
  const atomState = useAuroraPulse();
  const pulseState = state ?? atomState;

  return (
    <span
      role="status"
      data-testid="aurora-pulse"
      data-state={pulseState}
      aria-label={localize(PULSE_LABEL_KEYS[pulseState])}
      className={cn('inline-flex items-center gap-1.5', className)}
    >
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', PULSE_MARKS[pulseState])}
      />
      {withLabel && (
        <span className="text-xs text-text-secondary" aria-hidden="true">
          {localize(PULSE_LABEL_KEYS[pulseState])}
        </span>
      )}
    </span>
  );
}
