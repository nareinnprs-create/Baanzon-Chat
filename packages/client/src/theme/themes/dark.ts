import { IThemeRGB } from '../types';

/**
 * Baanzon Deep Ocean — Dark Theme
 * Never pure black. Deep oceanic depth with luminous aqua accents.
 */
export const darkTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '243 248 246', // #F3F8F6 (Primary Text)
  'rgb-text-secondary': '169 192 189', // #A9C0BD (Secondary Text)
  'rgb-text-secondary-alt': '110 137 135', // #6E8987 (Muted Text)
  'rgb-text-tertiary': '110 137 135', // #6E8987 (Muted Text)
  'rgb-text-muted': '110 137 135', // #6E8987 (Muted Text)
  'rgb-text-warning': '252 211 77', // #fcd34d (amber-300)
  'rgb-text-destructive': '248 113 113', // #f87171 (red-400)
  'rgb-shimmer-base': '243 248 246', // #F3F8F6, carried at 0.8 alpha
  'rgb-shimmer-dip': '110 137 135', // #6E8987

  // Link and accent colors
  'rgb-link': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-link-hover': '53 214 199', // #35D6C7 (Luminous Aqua brighter)
  'rgb-link-visited': '169 152 255', // #A998FF (Orchid)
  'rgb-accent-primary': '19 166 160', // #13A6A0 (Dark Teal)
  'rgb-accent-primary-hover': '70 226 210', // #46E2D2 (Luminous Aqua)

  // Ring colors
  'rgb-ring-primary': '19 166 160', // #13A6A0 (Dark Teal)

  // Header colors
  'rgb-header-primary': '10 28 32', // #0A1C20 (Surface)
  'rgb-header-hover': '16 39 43', // #10272B (Surface Elevated)
  'rgb-header-button-hover': '10 28 32', // #0A1C20 (Surface)

  // Surface colors
  'rgb-surface-active': '29 58 61', // #1D3A3D (Border)
  'rgb-surface-active-alt': '16 39 43', // #10272B (Surface Elevated)
  'rgb-surface-hover': '16 39 43', // #10272B (Surface Elevated)
  'rgb-surface-hover-alt': '29 58 61', // #1D3A3D (Border)
  'rgb-surface-composer-hover': '16 39 43', // #10272B (Surface Elevated)
  'rgb-surface-primary': '6 19 22', // #061316 (Background)
  'rgb-chart-widget-surface': '10 28 32', // #0A1C20 (Surface)
  'rgb-chart-widget-stroke': '29 58 61', // #1D3A3D (Border)
  'rgb-surface-primary-alt': '10 28 32', // #0A1C20 (Surface)
  'rgb-surface-primary-contrast': '16 39 43', // #10272B (Surface Elevated)
  'rgb-surface-secondary': '10 28 32', // #0A1C20 (Surface)
  'rgb-surface-secondary-alt': '16 39 43', // #10272B (Surface Elevated)
  'rgb-surface-tertiary': '16 39 43', // #10272B (Surface Elevated)
  'rgb-surface-tertiary-alt': '16 39 43', // #10272B (Surface Elevated)
  'rgb-surface-dialog': '10 28 32', // #0A1C20 (Surface)
  'rgb-surface-overlay': '0 0 0', // #000 (black)
  'rgb-surface-submit': '19 166 160', // #13A6A0 (Dark Teal)
  'rgb-surface-submit-hover': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-surface-destructive': '153 27 27', // #991b1b (red-800)
  'rgb-surface-destructive-hover': '127 29 29', // #7f1d1d (red-900)
  'rgb-surface-chat': '10 28 32', // #0A1C20 (Surface)
  'rgb-surface-code': '10 28 32', // #0A1C20 (Surface)
  'rgb-surface-inverted': '243 248 246', // #F3F8F6 (Primary Text)
  'rgb-surface-inverted-hover': '169 192 189', // #A9C0BD (Secondary Text)
  'rgb-text-inverted': '6 19 22', // #061316 (Background)
  'rgb-surface-fixed': '243 248 246', // #F3F8F6
  'rgb-surface-fixed-hover': '169 192 189', // #A9C0BD
  'rgb-text-fixed': '6 19 22', // #061316

  // Border colors
  'rgb-border-light': '29 58 61', // #1D3A3D (Border)
  'rgb-border-medium': '29 58 61', // #1D3A3D (Border)
  'rgb-border-medium-alt': '29 58 61', // #1D3A3D (Border)
  'rgb-border-heavy': '53 83 87', // #355357 (heavier border)
  'rgb-border-xheavy': '110 137 135', // #6E8987 (Muted)
  'rgb-border-destructive': '239 68 68', // #ef4444 (red-500)

  // Status colors
  'rgb-status-success': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-status-success-subtle': '6 60 69', // #063C45 (Deep Ocean)
  'rgb-status-success-border': '6 107 111', // #066B6F
  'rgb-status-success-strong': '19 166 160', // #13A6A0 (Dark Teal)
  'rgb-status-info': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-status-info-subtle': '6 60 69', // #063C45 (Deep Ocean)
  'rgb-status-info-border': '19 166 160', // #13A6A0 (Dark Teal)
  'rgb-status-info-strong': '19 166 160', // #13A6A0
  'rgb-status-warning': '252 211 77', // #fcd34d (amber-300)
  'rgb-status-warning-subtle': '42 28 3', // #2A1C03
  'rgb-status-warning-border': '146 64 14', // #92400e (amber-800)
  'rgb-status-warning-strong': '146 64 14', // #92400e
  'rgb-status-error': '252 165 165', // #fca5a5 (red-300)
  'rgb-status-error-subtle': '42 6 6', // #2A0606
  'rgb-status-error-border': '153 27 27', // #991b1b (red-800)
  'rgb-status-error-strong': '153 27 27', // #991b1b
  'rgb-status-neutral': '169 192 189', // #A9C0BD (Secondary Text)
  'rgb-status-neutral-subtle': '10 28 32', // #0A1C20 (Surface)
  'rgb-status-neutral-border': '29 58 61', // #1D3A3D (Border)
  'rgb-text-on-status': '6 19 22', // #061316 (Background, dark text on light status)

  // Brand colors
  'rgb-brand-purple': '169 152 255', // #A998FF (Orchid)

  /** Code syntax highlighting, measured against the `surface-code` fill. */
  'rgb-syntax-text': '243 248 246', // #F3F8F6
  'rgb-syntax-comment': '110 137 135', // #6E8987
  'rgb-syntax-meta': '169 192 189', // #A9C0BD
  'rgb-syntax-builtin': '216 194 157', // #D8C29D (Champagne)
  'rgb-syntax-keyword': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-syntax-string': '53 214 199', // #35D6C7 (Luminous Aqua)
  'rgb-syntax-attr': '169 152 255', // #A998FF (Orchid)
  'rgb-syntax-title': '252 165 165', // #fca5a5 (red-300)

  /** Categorical series scale — Baanzon Aurora-stepped for dark surface. */
  'rgb-series-1': '70 226 210', // #46E2D2 (Luminous Aqua)
  'rgb-series-2': '233 86 13', // #e9560d (orange)
  'rgb-series-3': '53 214 199', // #35D6C7 (Luminous Aqua)
  'rgb-series-4': '216 194 157', // #D8C29D (Champagne)
  'rgb-series-5': '169 152 255', // #A998FF (Orchid)
  'rgb-series-6': '19 166 160', // #13A6A0 (Dark Teal)
  'rgb-series-7': '70 226 210', // #46E2D2 (Luminous Aqua)

  /** Unchecked switch track. 3.38:1 against the page. */
  'rgb-switch-unchecked': '53 83 87', // #355357

  // Presentation
  'rgb-presentation': '10 28 32', // #0A1C20 (Surface)
};
