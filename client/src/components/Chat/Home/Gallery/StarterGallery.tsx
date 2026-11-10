import { useCallback, useState } from 'react';
import { STARTER_TEMPLATES, type StarterTemplate } from './templates';
import { useChatFormContext } from '~/Providers';
import { useLocalize } from '~/hooks';

const cardClassName =
  'flex min-h-[44px] w-full cursor-pointer flex-col items-start gap-1 rounded-xl border border-border-medium bg-surface-secondary px-3 py-2.5 text-left shadow-sm transition-colors duration-200 hover:border-border-heavy hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary';

/**
 * Curated starter templates shown below the Home mode chips. Clicking a card
 * fills the composer through the same form write PromptLab's apply uses
 * (`setValue('text', …)`) and never sends.
 */
export default function StarterGallery() {
  const localize = useLocalize();
  const { setValue } = useChatFormContext();
  const [expanded, setExpanded] = useState(false);

  const applyTemplate = useCallback(
    (template: StarterTemplate) => {
      setValue('text', template.prompt, { shouldDirty: true });
      /** Skipped on touchscreens so a tap does not raise the keyboard. */
      if (window.matchMedia?.('(pointer: coarse)').matches) {
        return;
      }
      document
        .querySelector<HTMLTextAreaElement>('[data-testid="composer-surface"] textarea')
        ?.focus();
    },
    [setValue],
  );

  return (
    <div className="flex w-full flex-col gap-2">
      <h3 className="text-center text-sm font-medium text-text-secondary">
        {localize('com_ui_gallery')}
      </h3>
      <ul
        aria-label={localize('com_ui_gallery')}
        className="grid w-full grid-cols-2 gap-2 md:grid-cols-4"
      >
        {STARTER_TEMPLATES.slice(0, expanded ? STARTER_TEMPLATES.length : 6).map((template) => (
          <li key={template.id}>
            <button type="button" onClick={() => applyTemplate(template)} className={cardClassName}>
              <span aria-hidden="true">{template.icon}</span>
              <span className="text-sm font-medium text-text-primary">{template.title}</span>
              <span className="text-xs capitalize text-text-tertiary">{template.category}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mx-auto min-h-10 rounded-lg px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {localize(expanded ? 'com_ui_show_less' : 'com_ui_show_more')}
      </button>
    </div>
  );
}
