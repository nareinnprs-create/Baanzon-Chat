import { IThemeRGB } from '../types';

/**
 * Baanzon high contrast accessibility themes.
 *
 * Both maps are complete: every token explicitly set to meet WCAG AAA (7:1)
 * for text and 3:1 for non-text borders and graphical objects.
 */

/**
 * Black ink on a white canvas with Baanzon teal accents at AAA contrast.
 */
export const highContrastLightTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '0 0 0', // #000000
  'rgb-text-secondary': '0 0 0', // #000000
  'rgb-text-secondary-alt': '0 0 0', // #000000
  'rgb-text-tertiary': '0 0 0', // #000000
  'rgb-text-muted': '0 0 0', // #000000
  'rgb-text-warning': '122 61 0', // #7a3d00
  'rgb-text-destructive': '161 0 0', // #a10000
  'rgb-shimmer-base': '0 0 0', // #000000
  'rgb-shimmer-dip': '77 77 77', // #4d4d4d

  // Link and accent colors
  'rgb-link': '0 80 77', // #00504d (dark Baanzon teal)
  'rgb-link-hover': '0 51 48', // #003330
  'rgb-link-visited': '85 73 180', // #5549b4
  'rgb-accent-primary': '0 80 77', // #00504d
  'rgb-accent-primary-hover': '0 51 48', // #003330

  // Ring colors
  'rgb-ring-primary': '0 0 0', // #000000

  // Header colors
  'rgb-header-primary': '255 255 255', // #ffffff
  'rgb-header-hover': '212 212 212', // #d4d4d4
  'rgb-header-button-hover': '212 212 212', // #d4d4d4

  // Surface colors
  'rgb-surface-active': '227 227 227', // #e3e3e3
  'rgb-surface-active-alt': '212 212 212', // #d4d4d4
  'rgb-surface-hover': '212 212 212', // #d4d4d4
  'rgb-surface-hover-alt': '184 184 184', // #b8b8b8
  'rgb-surface-composer-hover': '212 212 212', // #d4d4d4
  'rgb-surface-primary': '255 255 255', // #ffffff
  'rgb-chart-widget-surface': '255 255 255', // #ffffff
  'rgb-chart-widget-stroke': '0 0 0', // #000000
  'rgb-surface-primary-alt': '255 255 255', // #ffffff
  'rgb-surface-primary-contrast': '255 255 255', // #ffffff
  'rgb-surface-secondary': '255 255 255', // #ffffff
  'rgb-surface-secondary-alt': '255 255 255', // #ffffff
  'rgb-surface-tertiary': '255 255 255', // #ffffff
  'rgb-surface-tertiary-alt': '255 255 255', // #ffffff
  'rgb-surface-dialog': '255 255 255', // #ffffff
  'rgb-surface-overlay': '0 0 0', // #000000
  'rgb-surface-submit': '0 80 77', // #00504d (dark Baanzon teal)
  'rgb-surface-submit-hover': '0 51 48', // #003330
  'rgb-surface-destructive': '161 0 0', // #a10000
  'rgb-surface-destructive-hover': '122 0 0', // #7a0000
  'rgb-surface-chat': '255 255 255', // #ffffff
  'rgb-surface-code': '255 255 255', // #ffffff
  'rgb-surface-inverted': '0 0 0', // #000000
  'rgb-surface-inverted-hover': '51 51 51', // #333333
  'rgb-text-inverted': '255 255 255', // #ffffff
  'rgb-surface-fixed': '255 255 255', // #ffffff
  'rgb-surface-fixed-hover': '212 212 212', // #d4d4d4
  'rgb-text-fixed': '0 0 0', // #000000

  // Border colors
  'rgb-border-light': '0 0 0', // #000000
  'rgb-border-medium': '0 0 0', // #000000
  'rgb-border-medium-alt': '0 0 0', // #000000
  'rgb-border-heavy': '0 0 0', // #000000
  'rgb-border-xheavy': '0 0 0', // #000000
  'rgb-border-destructive': '161 0 0', // #a10000

  // Status colors
  'rgb-status-success': '0 80 77', // #00504d
  'rgb-status-success-subtle': '255 255 255', // #ffffff
  'rgb-status-success-border': '0 80 77', // #00504d
  'rgb-status-success-strong': '0 80 77', // #00504d
  'rgb-status-info': '0 65 122', // #00417a
  'rgb-status-info-subtle': '255 255 255', // #ffffff
  'rgb-status-info-border': '0 65 122', // #00417a
  'rgb-status-info-strong': '0 65 122', // #00417a
  'rgb-status-warning': '122 61 0', // #7a3d00
  'rgb-status-warning-subtle': '255 255 255', // #ffffff
  'rgb-status-warning-border': '122 61 0', // #7a3d00
  'rgb-status-warning-strong': '122 61 0', // #7a3d00
  'rgb-status-error': '161 0 0', // #a10000
  'rgb-status-error-subtle': '255 255 255', // #ffffff
  'rgb-status-error-border': '161 0 0', // #a10000
  'rgb-status-error-strong': '161 0 0', // #a10000
  'rgb-status-neutral': '0 0 0', // #000000
  'rgb-status-neutral-subtle': '255 255 255', // #ffffff
  'rgb-status-neutral-border': '0 0 0', // #000000
  'rgb-text-on-status': '255 255 255', // #ffffff

  // Brand colors
  'rgb-brand-purple': '85 73 180', // #5549b4

  /** Code syntax highlighting at AAA on white. */
  'rgb-syntax-text': '0 0 0', // #000000
  'rgb-syntax-comment': '77 77 77', // #4d4d4d
  'rgb-syntax-meta': '77 77 77', // #4d4d4d
  'rgb-syntax-builtin': '107 61 0', // #6b3d00
  'rgb-syntax-keyword': '0 61 153', // #003d99
  'rgb-syntax-string': '0 80 77', // #00504d (Baanzon teal)
  'rgb-syntax-attr': '85 73 180', // #5549b4
  'rgb-syntax-title': '143 26 16', // #8f1a10

  /** Categorical series scale at AAA on white canvas. */
  'rgb-series-1': '0 80 77', // #00504d (Baanzon teal)
  'rgb-series-2': '143 59 0', // #8f3b00
  'rgb-series-3': '0 82 79', // #00524f
  'rgb-series-4': '92 74 0', // #5c4a00
  'rgb-series-5': '148 0 92', // #94005c
  'rgb-series-6': '85 73 180', // #5549b4
  'rgb-series-7': '15 92 15', // #0f5c0f

  'rgb-switch-unchecked': '102 102 102', // #666666

  // Presentation
  'rgb-presentation': '255 255 255', // #ffffff
};

/**
 * White ink on a dark canvas with Baanzon luminous aqua accents at AAA contrast.
 */
export const highContrastDarkTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '255 255 255', // #ffffff
  'rgb-text-secondary': '255 255 255', // #ffffff
  'rgb-text-secondary-alt': '255 255 255', // #ffffff
  'rgb-text-tertiary': '255 255 255', // #ffffff
  'rgb-text-muted': '255 255 255', // #ffffff
  'rgb-text-warning': '255 201 77', // #ffc94d
  'rgb-text-destructive': '255 143 143', // #ff8f8f
  'rgb-shimmer-base': '255 255 255', // #ffffff
  'rgb-shimmer-dip': '179 179 179', // #b3b3b3

  // Link and accent colors
  'rgb-link': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-link-hover': '120 240 230', // #78F0E6
  'rgb-link-visited': '189 178 255', // #BDB2FF
  'rgb-accent-primary': '70 226 210', // #46E2D2
  'rgb-accent-primary-hover': '120 240 230', // #78F0E6

  // Ring colors
  'rgb-ring-primary': '255 255 255', // #ffffff

  // Header colors
  'rgb-header-primary': '6 19 22', // #061316 (Deep Ocean background)
  'rgb-header-hover': '29 58 61', // #1D3A3D
  'rgb-header-button-hover': '29 58 61', // #1D3A3D

  // Surface colors
  'rgb-surface-active': '29 58 61', // #1D3A3D
  'rgb-surface-active-alt': '29 58 61', // #1D3A3D
  'rgb-surface-hover': '29 58 61', // #1D3A3D
  'rgb-surface-hover-alt': '53 83 87', // #355357
  'rgb-surface-composer-hover': '29 58 61', // #1D3A3D
  'rgb-surface-primary': '6 19 22', // #061316
  'rgb-chart-widget-surface': '6 19 22', // #061316
  'rgb-chart-widget-stroke': '255 255 255', // #ffffff
  'rgb-surface-primary-alt': '6 19 22', // #061316
  'rgb-surface-primary-contrast': '6 19 22', // #061316
  'rgb-surface-secondary': '6 19 22', // #061316
  'rgb-surface-secondary-alt': '6 19 22', // #061316
  'rgb-surface-tertiary': '6 19 22', // #061316
  'rgb-surface-tertiary-alt': '6 19 22', // #061316
  'rgb-surface-dialog': '6 19 22', // #061316
  'rgb-surface-overlay': '0 0 0', // #000000
  'rgb-surface-submit': '70 226 210', // #46E2D2
  'rgb-surface-submit-hover': '120 240 230', // #78F0E6
  'rgb-surface-destructive': '255 143 143', // #ff8f8f
  'rgb-surface-destructive-hover': '255 179 179', // #ffb3b3
  'rgb-surface-chat': '6 19 22', // #061316
  'rgb-surface-code': '6 19 22', // #061316
  'rgb-surface-inverted': '255 255 255', // #ffffff
  'rgb-surface-inverted-hover': '212 212 212', // #d4d4d4
  'rgb-text-inverted': '6 19 22', // #061316
  'rgb-surface-fixed': '255 255 255', // #ffffff
  'rgb-surface-fixed-hover': '212 212 212', // #d4d4d4
  'rgb-text-fixed': '0 0 0', // #000000

  // Border colors
  'rgb-border-light': '255 255 255', // #ffffff
  'rgb-border-medium': '255 255 255', // #ffffff
  'rgb-border-medium-alt': '255 255 255', // #ffffff
  'rgb-border-heavy': '255 255 255', // #ffffff
  'rgb-border-xheavy': '255 255 255', // #ffffff
  'rgb-border-destructive': '255 143 143', // #ff8f8f

  // Status colors
  'rgb-status-success': '70 226 210', // #46E2D2
  'rgb-status-success-subtle': '6 19 22', // #061316
  'rgb-status-success-border': '70 226 210', // #46E2D2
  'rgb-status-success-strong': '70 226 210', // #46E2D2
  'rgb-status-info': '70 226 210', // #46E2D2
  'rgb-status-info-subtle': '6 19 22', // #061316
  'rgb-status-info-border': '70 226 210', // #46E2D2
  'rgb-status-info-strong': '70 226 210', // #46E2D2
  'rgb-status-warning': '255 201 77', // #ffc94d
  'rgb-status-warning-subtle': '6 19 22', // #061316
  'rgb-status-warning-border': '255 201 77', // #ffc94d
  'rgb-status-warning-strong': '255 201 77', // #ffc94d
  'rgb-status-error': '255 143 143', // #ff8f8f
  'rgb-status-error-subtle': '6 19 22', // #061316
  'rgb-status-error-border': '255 143 143', // #ff8f8f
  'rgb-status-error-strong': '255 143 143', // #ff8f8f
  'rgb-status-neutral': '255 255 255', // #ffffff
  'rgb-status-neutral-subtle': '6 19 22', // #061316
  'rgb-status-neutral-border': '255 255 255', // #ffffff
  'rgb-text-on-status': '6 19 22', // #061316

  // Brand colors
  'rgb-brand-purple': '189 178 255', // #BDB2FF

  /** Code syntax highlighting at AAA on dark code surface. */
  'rgb-syntax-text': '255 255 255', // #ffffff
  'rgb-syntax-comment': '179 179 179', // #b3b3b3
  'rgb-syntax-meta': '179 179 179', // #b3b3b3
  'rgb-syntax-builtin': '216 194 157', // #D8C29D (Champagne)
  'rgb-syntax-keyword': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-syntax-string': '53 214 199', // #35D6C7
  'rgb-syntax-attr': '169 152 255', // #A998FF (Orchid)
  'rgb-syntax-title': '255 143 143', // #ff8f8f

  /** Categorical series scale at AAA on dark canvas. */
  'rgb-series-1': '70 226 210', // #46E2D2
  'rgb-series-2': '255 179 102', // #ffb366
  'rgb-series-3': '53 214 199', // #35D6C7
  'rgb-series-4': '216 194 157', // #D8C29D (Champagne)
  'rgb-series-5': '169 152 255', // #A998FF (Orchid)
  'rgb-series-6': '19 166 160', // #13A6A0 (Dark Teal)
  'rgb-series-7': '70 226 210', // #46E2D2

  'rgb-switch-unchecked': '128 128 128', // #808080

  // Presentation
  'rgb-presentation': '6 19 22', // #061316
};
