import type { ReactNode } from 'react';
import { useInterfaceMode } from '~/store/settings';
import useAtelierFocusMode from './useAtelierFocusMode';

/**
 * G1 step 2 — Monolith atelier shell scaffold. Visual only: a tone layer
 * behind the EXISTING shell (same sidebar, pane and mobile systems). In
 * classic mode this renders a bare fragment, so the default path gains no
 * DOM at all; `data-atelier` on the wrapper is the CSS hook for style.css.
 * The Iris thread marker is intentionally not here yet (G2).
 */
export default function AtelierShell({ children }: { children: ReactNode }) {
  const atelier = useInterfaceMode() === 'atelier';
  /** Focus tracking is inert outside atelier mode. */
  useAtelierFocusMode(atelier);

  if (!atelier) {
    return <>{children}</>;
  }

  return (
    <div data-atelier="true" className="h-full">
      {children}
    </div>
  );
}
