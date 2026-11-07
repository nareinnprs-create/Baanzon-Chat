import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { atelierFocusMode } from '~/store/settings';

/** The main composer textarea's test id — the only composer focus source for now. */
const COMPOSER_SELECTOR = '[data-testid="text-input"]';

function isWithinComposer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(COMPOSER_SELECTOR) != null;
}

/**
 * Atelier focus scaffold: reports whether the chat composer's textarea is
 * focused so the shell can dim its nav chrome while typing. Listens to the
 * document-level `focusin`/`focusout` pair (they bubble, unlike focus/blur)
 * rather than asking the composer to publish its local focus state; atelier
 * opt-in comes from `atelierFocusMode`, Esc dismisses it. Mirrors the active
 * state onto `body[data-atelier-focus]` as a global style hook for style.css.
 * Inert unless `enabled` (i.e. outside atelier mode).
 *
 * Listeners attach once per activation — the Esc handler reads the focus
 * state through a ref, so focus flips never re-subscribe (and never lose
 * an in-flight focusin/focusout).
 */
export default function useAtelierFocusMode(enabled: boolean): boolean {
  const optIn = useAtomValue(atelierFocusMode);
  const setOptIn = useSetAtom(atelierFocusMode);
  const [composerFocused, setComposerFocused] = useState(false);
  const composerFocusedRef = useRef(false);

  const active = enabled && optIn;

  useEffect(() => {
    if (!active) {
      return;
    }

    const setFocused = (value: boolean) => {
      composerFocusedRef.current = value;
      setComposerFocused(value);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isWithinComposer(event.target)) {
        setFocused(true);
      }
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (isWithinComposer(event.target) && !isWithinComposer(event.relatedTarget)) {
        setFocused(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      /** Same menu guard as the drawer's Escape path: menu Escape closes the
       *  menu, not the mode. Esc only means "leave focus mode" while the
       *  composer actually holds the focus being tracked. */
      if (event.key !== 'Escape' || !composerFocusedRef.current || event.defaultPrevented) {
        return;
      }
      if (document.querySelector('[role="menu"]:not([hidden])') != null) {
        return;
      }
      setOptIn(false);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('keydown', handleKeyDown);
      composerFocusedRef.current = false;
      setComposerFocused(false);
    };
  }, [active, setOptIn]);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (composerFocused) {
      document.body.setAttribute('data-atelier-focus', 'true');
    } else {
      document.body.removeAttribute('data-atelier-focus');
    }
    return () => document.body.removeAttribute('data-atelier-focus');
  }, [active, composerFocused]);

  return active && composerFocused;
}
