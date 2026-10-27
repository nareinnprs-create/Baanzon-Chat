/**
 * Runtime readers for the semantic theme tokens the Data Lab charts are
 * styled with. ECharts paints to a canvas, where Tailwind classes cannot
 * carry color, so the resolved custom properties are read from a rendered
 * element instead — the same `--series-*` / `--border-*` / `--text-*` /
 * `--surface-*` channel triplets the SVG charts consumed through classes
 * (defined for `:root` and `.dark` in `client/src/style.css`, read back the
 * same way as the screenshot canvas background in `useScreenshot`). The
 * comma form matters: zrender's color parser strips spaces before parsing,
 * so `rgb(8 127 131)` would not resolve. A missing or malformed value yields
 * `undefined` and the chart option simply omits that color (ECharts' own
 * default applies — the case under jsdom, which does not resolve custom
 * properties from stylesheets).
 */

/** Channel-triplet tokens for the categorical series slots (see palette.ts). */
const SERIES_TOKENS = [
  '--series-1',
  '--series-2',
  '--series-3',
  '--series-4',
  '--series-5',
  '--series-6',
  '--series-7',
] as const;

/** Read a `--token` holding space-separated RGB channels as `rgb(r, g, b)`. */
export function tokenColor(element: Element, token: string): string | undefined {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return undefined;
  }
  const triplet = window.getComputedStyle(element).getPropertyValue(token).trim();
  if (!/^\d+\s+\d+\s+\d+$/.test(triplet)) {
    return undefined;
  }
  return `rgb(${triplet.split(/\s+/).join(', ')})`;
}

/**
 * Categorical series colors in slot order, wrapping past the seven slots the
 * same way the palette's Tailwind class helpers wrap their slot index.
 */
export function seriesColors(element: Element, count: number): string[] {
  const colors: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const color = tokenColor(element, SERIES_TOKENS[index % SERIES_TOKENS.length]);
    if (color) {
      colors.push(color);
    }
  }
  return colors;
}
