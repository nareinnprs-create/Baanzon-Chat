import type { ReactNode } from 'react';
import { useInterfaceMode } from '~/store/settings';
import useAtelierFocusMode from './useAtelierFocusMode';
import useAtelierHeaderReveal from './useAtelierHeaderReveal';

/**
 * G2 — Monolith atelier shell. Visual only: a tone layer behind the EXISTING
 * shell (same sidebar, pane and mobile systems). In classic mode this renders
 * a bare fragment, so the default path gains no DOM at all; `data-atelier` on
 * the wrapper is the CSS hook for style.css, and `data-atelier-reveal` (set
 * only while the user scrolls up in the conversation) reveals the breadcrumb
 * strip the Header renders for atelier.
 */
export default function AtelierShell({ children }: { children: ReactNode }) {
  const atelier = useInterfaceMode() === 'atelier';
  /** Focus tracking is inert outside atelier mode. */
  useAtelierFocusMode(atelier);
  const headerRevealed = useAtelierHeaderReveal(atelier);

  if (!atelier) {
    return <>{children}</>;
  }

  return (
    <div data-atelier="true" data-atelier-reveal={headerRevealed ? 'true' : undefined} className="h-full">
      {children}
    </div>
  );
}
