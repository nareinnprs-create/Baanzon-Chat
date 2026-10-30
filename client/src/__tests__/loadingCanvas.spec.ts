import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  darkTheme,
  defaultTheme,
  highContrastDarkTheme,
  highContrastLightTheme,
} from '@librechat/client';
import type { IThemeRGB } from '@librechat/client';

/** The pre-React canvas is painted by an inline bootstrap in `index.html`, which
 *  no bundle imports, so the only way to hold it to the resolved palette is to
 *  run the script the document actually ships. */
const bootstrap = (() => {
  const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(([, body]) => body)
    .find((body) => body.includes('#loading-container'));

  if (!script) {
    throw new Error('index.html no longer carries a #loading-container bootstrap');
  }

  return script;
})();

const canvasFor = (stored: string | null, matching: string[]): string | undefined => {
  window.localStorage.clear();
  if (stored !== null) {
    window.localStorage.setItem('color-theme', stored);
  }
  window.matchMedia = ((query: string) =>
    ({ matches: matching.includes(query) }) as MediaQueryList) as typeof window.matchMedia;
  document.head.querySelectorAll('style').forEach((node) => node.remove());

  new Function(bootstrap)();

  return document.head
    .querySelector('style')
    ?.innerHTML.match(/background-color:\s*([^;\s]+)/)?.[1];
};

/** The registry stores bare `R G B` triplets and the bootstrap needs a CSS
 *  colour, so every expectation below is derived from the palette rather than
 *  restated as a literal. `index.html` cannot read the registry — it runs before
 *  any bundle — so this is what stops that copy from drifting the way a literal
 *  here would: move a palette and the shipped script fails here instead. */
const canvasOf = (palette: IThemeRGB): string => {
  const triplet = palette['rgb-surface-primary'];
  if (!triplet) {
    throw new Error('palette declares no rgb-surface-primary');
  }
  return `#${triplet
    .split(' ')
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
};

const LIGHT = canvasOf(defaultTheme);
const DARK = canvasOf(darkTheme);
const HIGH_CONTRAST_LIGHT = canvasOf(highContrastLightTheme);
const HIGH_CONTRAST_DARK = canvasOf(highContrastDarkTheme);

const DARK_SCHEME = '(prefers-color-scheme: dark)';
const MORE_CONTRAST = '(prefers-contrast: more)';
const CUSTOM_CONTRAST = '(prefers-contrast: custom)';
const FORCED_COLORS = '(forced-colors: active)';

describe('loading canvas', () => {
  it.each([
    ['high-contrast-dark', HIGH_CONTRAST_DARK],
    ['high-contrast-light', HIGH_CONTRAST_LIGHT],
    ['dark', DARK],
    ['light', LIGHT],
  ])('paints the stored %s mode', (stored, expected) => {
    expect(canvasFor(stored, [])).toBe(expected);
  });

  /** The canvas mirrors `rgb-surface-primary`, and the standard and
   *  high-contrast dark palettes declare the same one. That is why the bootstrap
   *  reads only the colour scheme: a contrast request has nothing left to choose
   *  between, and a palette that later gives the contrast canvas its own value
   *  has to bring the prefers-contrast and forced-colors queries back with it. */
  it('resolves one dark canvas for both dark palettes', () => {
    expect(HIGH_CONTRAST_DARK).toBe(DARK);
  });

  it('follows the OS colour scheme under system', () => {
    expect(canvasFor('system', [DARK_SCHEME])).toBe(DARK);
    expect(canvasFor('system', [])).toBe(LIGHT);
  });

  /** A Windows Contrast Theme reports `forced-colors: active` with
   *  `prefers-contrast: custom`, never `more`, so none of the three the theme
   *  provider reads may leave the canvas on the other scheme's surface. */
  it.each([MORE_CONTRAST, CUSTOM_CONTRAST, FORCED_COLORS])(
    'keeps the dark canvas under %s',
    (query) => {
      expect(canvasFor('system', [DARK_SCHEME, query])).toBe(DARK);
      expect(canvasFor('system', [query])).toBe(LIGHT);
    },
  );

  /** An unset or unrecognised value is what `getInitialTheme` resolves as
   *  `system`, so the canvas has to resolve it the same way. */
  it('treats an unset or unknown mode as system', () => {
    expect(canvasFor(null, [DARK_SCHEME])).toBe(DARK);
    expect(canvasFor(null, [])).toBe(LIGHT);
    expect(canvasFor('sepia', [DARK_SCHEME])).toBe(DARK);
  });
});
