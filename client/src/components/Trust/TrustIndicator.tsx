import type { TTrustState } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The TrustIndicator badge (blueprint B6 / A7.1b): one pill per trust state,
 * colored through the shared semantic status roles — `verified` reads positive,
 * `conflicting` reads destructive, `supported` and `uncertain` stay on neutral
 * tones. `Sources·N` is not a fifth state; it is the optional `sourcesCount`
 * segment beside the pill, hidden unless at least one source backs the verdict.
 * The verdict itself is announced through `role="status"` so screen readers
 * hear the localized state (and source count) without hunting the visuals.
 */

type TrustSize = 'sm' | 'md';

const sizeClasses: Record<TrustSize, string> = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-1 text-sm',
};

const stateClasses: Record<TTrustState, string> = {
  verified: 'border-status-success-border bg-status-success-subtle text-status-success',
  supported: 'border-status-info-border bg-status-info-subtle text-status-info',
  uncertain: 'border-status-neutral-border bg-status-neutral-subtle text-status-neutral',
  conflicting: 'border-status-error-border bg-status-error-subtle text-status-error',
};

const stateLabelKeys: Record<TTrustState, TranslationKeys> = {
  verified: 'com_ui_trust_verified',
  supported: 'com_ui_trust_supported',
  uncertain: 'com_ui_trust_uncertain',
  conflicting: 'com_ui_trust_conflicting',
};

interface TrustIndicatorProps {
  state: TTrustState;
  /** `TTrustScore.sourcesCount` — the `Sources·N` segment; hidden when absent or zero. */
  sourcesCount?: number;
  size?: TrustSize;
}

export default function TrustIndicator({ state, sourcesCount, size = 'md' }: TrustIndicatorProps) {
  const localize = useLocalize();
  const stateLabel = localize(stateLabelKeys[state]);
  const count = typeof sourcesCount === 'number' && sourcesCount > 0 ? sourcesCount : null;

  const ariaLabel = count
    ? localize('com_ui_trust_label_sources', { 0: stateLabel, 1: count })
    : localize('com_ui_trust_label', { 0: stateLabel });

  return (
    <span aria-label={ariaLabel} className="inline-flex items-center gap-1.5" role="status">
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center whitespace-nowrap rounded-md border font-medium',
          sizeClasses[size],
          stateClasses[state],
        )}
      >
        {stateLabel}
      </span>
      {count && (
        <span
          aria-hidden="true"
          className="whitespace-nowrap text-xs tabular-nums text-text-tertiary"
        >
          {localize('com_ui_trust_sources_count', { 0: count })}
        </span>
      )}
    </span>
  );
}
