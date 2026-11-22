import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Sparkles, Telescope, Waves } from 'lucide-react';
import { useLocalize } from '~/hooks';

interface CapabilityCardsProps {
  /** Focuses the composer for the "ask" card; omitted where no composer exists. */
  onAsk?: () => void;
}

/**
 * Capability-led landing: four cards that open surfaces that actually exist.
 * They never send a message on the user's behalf - "ask" focuses the composer,
 * the rest navigate.
 */
export default function CapabilityCards({ onAsk }: CapabilityCardsProps) {
  const localize = useLocalize();
  const navigate = useNavigate();

  const ask = useCallback(() => {
    if (onAsk) {
      onAsk();
      return;
    }
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="text-input"]');
    textarea?.focus();
  }, [onAsk]);

  const cards = [
    {
      id: 'ask',
      icon: MessageSquare,
      title: localize('com_ui_cap_ask'),
      hint: localize('com_ui_cap_ask_hint'),
      onClick: ask,
    },
    {
      id: 'create',
      icon: Sparkles,
      title: localize('com_ui_cap_create'),
      hint: localize('com_ui_cap_create_hint'),
      onClick: () => navigate('/canvas'),
    },
    {
      id: 'research',
      icon: Telescope,
      title: localize('com_ui_cap_research'),
      hint: localize('com_ui_cap_research_hint'),
      onClick: () => navigate('/deep-research'),
    },
    {
      id: 'talk',
      icon: Waves,
      title: localize('com_ui_cap_talk'),
      hint: localize('com_ui_cap_talk_hint'),
      onClick: () => navigate('/voice'),
    },
  ];

  return (
    <div className="animate-fadeIn mt-6 grid w-full max-w-2xl grid-cols-2 gap-2 px-4 sm:gap-3 lg:grid-cols-4">
      {cards.map(({ id, icon: Icon, title, hint, onClick }) => (
        <button
          key={id}
          type="button"
          onClick={onClick}
          data-testid={`capability-card-${id}`}
          className="group flex flex-col items-start gap-1 rounded-2xl border border-border-light bg-surface-secondary p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-border-heavy hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary motion-reduce:transform-none motion-reduce:transition-none"
        >
          <Icon
            className="size-4 text-text-secondary transition-colors group-hover:text-text-primary"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-text-primary">{title}</span>
          <span className="line-clamp-2 text-xs text-text-secondary">{hint}</span>
        </button>
      ))}
    </div>
  );
}
