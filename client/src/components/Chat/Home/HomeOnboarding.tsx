import { useCallback, useId } from 'react';
import { Constants } from 'librechat-data-provider';
import { MessageCircle, Telescope, ChartColumn, Image } from 'lucide-react';
import type { HomeMode } from './modes';
import { HOME_MODES, resolveModePreset } from './modes';
import { useGetStartupConfig } from '~/data-provider';
import { specDisplayFieldReset } from '~/utils';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';

/** Decorative icon per mode; the chip's accessible name is its visible label. */
const MODE_ICON: Record<string, typeof MessageCircle> = {
  chat: MessageCircle,
  deepResearch: Telescope,
  dataAnalysis: ChartColumn,
  image: Image,
};

const chipClassName =
  'flex cursor-pointer items-center gap-2 rounded-full border border-border-medium bg-surface-secondary px-4 py-2 text-sm text-text-secondary shadow-sm transition-colors duration-200 hover:border-border-heavy hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary';

/**
 * Light onboarding shown on the Home / new-conversation landing.
 *
 * Selecting a mode starts a new conversation through the app's existing
 * `newConversation` flow (the same one the model selector and agent picker use),
 * so it resets the composer and lands the user in it with the chosen
 * endpoint/preset applied. Modes resolve to a deployment-configured model spec,
 * or fall back to the default endpoint — see `./modes`.
 */
export default function HomeOnboarding() {
  const localize = useLocalize();
  const headingId = useId();
  const { newConversation } = useChatContext();
  const { data: startupConfig, isLoading } = useGetStartupConfig();

  const handleSelect = useCallback(
    (mode: HomeMode) => {
      const preset = resolveModePreset(mode, startupConfig);
      newConversation({
        template: { ...specDisplayFieldReset, conversationId: Constants.NEW_CONVO as string },
        /* No preset means "use the default endpoint", which `newConversation`
         * resolves on its own — we never synthesize an endpoint or capability. */
        ...(preset ? { preset } : {}),
      });
    },
    [newConversation, startupConfig],
  );

  return (
    <section
      aria-labelledby={headingId}
      className="animate-fadeIn mt-6 flex w-full flex-col items-center gap-3 px-4"
    >
      <h2 id={headingId} className="text-center text-base font-medium text-text-primary">
        {localize('com_ui_home_heading')}
      </h2>
      <p className="max-w-md text-center text-sm text-text-secondary">
        {localize('com_ui_home_subcopy')}
      </p>
      {isLoading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-wrap justify-center gap-2">
          <span className="sr-only">{localize('com_ui_home_modes_loading')}</span>
          {HOME_MODES.map((mode) => (
            <span
              key={mode.id}
              aria-hidden="true"
              className="h-9 w-24 animate-pulse rounded-full bg-surface-tertiary"
            />
          ))}
        </div>
      ) : (
        <ul
          role="list"
          aria-label={localize('com_ui_home_modes_label')}
          className="flex w-full flex-wrap items-stretch justify-center gap-2"
        >
          {HOME_MODES.map((mode) => {
            const Icon = MODE_ICON[mode.id] ?? MessageCircle;
            return (
              <li key={mode.id}>
                <button type="button" onClick={() => handleSelect(mode)} className={chipClassName}>
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  <span>{localize(mode.labelKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
