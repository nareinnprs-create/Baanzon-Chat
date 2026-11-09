import { useCallback, useId } from 'react';
import { Constants } from 'librechat-data-provider';
import { MessageCircle, Telescope, ChartColumn, Image } from 'lucide-react';
import type { HomeMode } from './modes';
import { HOME_MODES, resolveModePreset } from './modes';
import StarterGallery from './Gallery/StarterGallery';
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
  'group flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border-light bg-surface-primary px-4 py-2.5 text-sm font-medium text-text-secondary shadow-sm transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-heavy hover:bg-surface-secondary hover:text-text-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary motion-reduce:transform-none';

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
      data-baanzon-home="true"
      className="animate-fadeIn mt-8 flex w-full max-w-3xl flex-col items-center gap-5 px-4"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h2
          id={headingId}
          className="text-center text-xl font-semibold tracking-tight text-text-primary sm:text-2xl"
        >
          {localize('com_ui_home_heading')}
        </h2>
      </div>
      <p className="max-w-lg text-center text-sm leading-6 text-text-secondary">
        {localize('com_ui_home_subcopy')}
      </p>
      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex flex-wrap justify-center gap-2"
        >
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
          aria-label={localize('com_ui_home_modes_label')}
          className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {HOME_MODES.map((mode) => {
            const Icon = MODE_ICON[mode.id] ?? MessageCircle;
            return (
              <li key={mode.id} className="min-w-0">
                <button type="button" onClick={() => handleSelect(mode)} className={chipClassName}>
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-text-primary transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none"
                  />
                  <span className="truncate">{localize(mode.labelKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <StarterGallery />
    </section>
  );
}
