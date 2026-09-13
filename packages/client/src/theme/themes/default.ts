import { IThemeRGB } from '../types';

/**
 * Baanzon Aurora Pearl — Light Theme
 * Premium paper and soft daylight.
 */
export const defaultTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '16 42 45', // #102A2D (Primary Text)
  'rgb-text-secondary': '82 104 106', // #52686A (Secondary Text)
  'rgb-text-secondary-alt': '110 127 128', // #6E7F80 (Muted Text)
  'rgb-text-tertiary': '110 127 128', // #6E7F80 (Muted Text)
  'rgb-text-muted': '110 127 128', // #6E7F80 (Muted Text)
  'rgb-text-warning': '180 83 9', // #b45309 (amber-700)
  'rgb-text-destructive': '220 38 38', // #dc2626 (red-600)
  'rgb-shimmer-base': '16 42 45', // #102A2D, matching text-primary
  'rgb-shimmer-dip': '110 127 128', // #6E7F80

  // Link and accent colors
  'rgb-link': '8 127 131', // #087F83 (Baanzon Teal)
  'rgb-link-hover': '6 107 111', // #066B6F (Teal darker)
  'rgb-link-visited': '155 138 251', // #9B8AFB (Soft Orchid)
  'rgb-accent-primary': '8 127 131', // #087F83 (Baanzon Teal)
  'rgb-accent-primary-hover': '6 107 111', // #066B6F (Teal darker)

  // Ring colors
  'rgb-ring-primary': '8 127 131', // #087F83 (Baanzon Teal)

  // Header colors
  'rgb-header-primary': '255 255 255', // #fff (white)
  'rgb-header-hover': '247 250 248', // #F7FAF8 (Pearl background)
  'rgb-header-button-hover': '247 250 248', // #F7FAF8 (Pearl background)

  // Surface colors
  'rgb-surface-active': '232 243 240', // #E8F3F0 (Mist)
  'rgb-surface-active-alt': '221 233 229', // #DDE9E5 (Border)
  'rgb-surface-hover': '232 243 240', // #E8F3F0 (Mist)
  'rgb-surface-hover-alt': '221 233 229', // #DDE9E5 (Border)
  'rgb-surface-composer-hover': '232 243 240', // #E8F3F0 (Mist)
  'rgb-surface-primary': '255 255 255', // #FFFFFF (Surface)
  'rgb-chart-widget-surface': '255 255 255', // #FFFFFF
  'rgb-chart-widget-stroke': '221 233 229', // #DDE9E5 (Border)
  'rgb-surface-primary-alt': '247 250 248', // #F7FAF8 (Pearl background)
  'rgb-surface-primary-contrast': '232 243 240', // #E8F3F0 (Mist)
  'rgb-surface-secondary': '247 250 248', // #F7FAF8 (Pearl background)
  'rgb-surface-secondary-alt': '239 246 243', // #EFF6F3 (Surface Soft)
  'rgb-surface-tertiary': '232 243 240', // #E8F3F0 (Mist)
  'rgb-surface-tertiary-alt': '255 255 255', // #FFFFFF (Surface)
  'rgb-surface-dialog': '255 255 255', // #FFFFFF (Surface)
  'rgb-surface-overlay': '16 42 45', // #102A2D (overlay)
  'rgb-surface-submit': '8 127 131', // #087F83 (Baanzon Teal)
  'rgb-surface-submit-hover': '6 107 111', // #066B6F (Teal darker)
  'rgb-surface-destructive': '185 28 28', // #b91c1c (red-700)
  'rgb-surface-destructive-hover': '153 27 27', // #991b1b (red-800)
  'rgb-surface-chat': '255 255 255', // #FFFFFF (Surface)
  'rgb-surface-code': '247 250 248', // #F7FAF8 (Pearl background)
  'rgb-surface-inverted': '6 60 69', // #063C45 (Deep Ocean)
  'rgb-surface-inverted-hover': '8 127 131', // #087F83 (Teal)
  'rgb-text-inverted': '255 255 255', // #FFFFFF
  'rgb-surface-fixed': '255 255 255', // #FFFFFF
  'rgb-surface-fixed-hover': '232 243 240', // #E8F3F0 (Mist)
  'rgb-text-fixed': '16 42 45', // #102A2D

  // Border colors
  'rgb-border-light': '221 233 229', // #DDE9E5 (Border)
  'rgb-border-medium': '200 218 214', // #C8DAD6 (darker border)
  'rgb-border-medium-alt': '200 218 214', // #C8DAD6
  'rgb-border-heavy': '160 185 180', // #A0B9B4 (heavy border)
  'rgb-border-xheavy': '110 127 128', // #6E7F80 (Muted)
  'rgb-border-destructive': '220 38 38', // #dc2626 (red-600)

  // Status colors
  'rgb-status-success': '4 120 87', // #047857 (green-700)
  'rgb-status-success-subtle': '236 253 245', // #ecfdf5 (green-50)
  'rgb-status-success-border': '110 231 183', // #6ee7b7 (green-300)
  'rgb-status-success-strong': '2 133 94', // #02855e
  'rgb-status-info': '8 127 131', // #087F83 (Baanzon Teal)
  'rgb-status-info-subtle': '232 243 240', // #E8F3F0 (Mist)
  'rgb-status-info-border': '53 214 199', // #35D6C7 (Luminous Aqua)
  'rgb-status-info-strong': '8 127 131', // #087F83 (Teal)
  'rgb-status-warning': '180 83 9', // #b45309 (amber-700)
  'rgb-status-warning-subtle': '255 251 235', // #fffbeb (amber-50)
  'rgb-status-warning-border': '252 211 77', // #fcd34d (amber-300)
  'rgb-status-warning-strong': '199 82 9', // #c75209
  'rgb-status-error': '185 28 28', // #b91c1c (red-700)
  'rgb-status-error-subtle': '254 242 242', // #fef2f2 (red-50)
  'rgb-status-error-border': '252 165 165', // #fca5a5 (red-300)
  'rgb-status-error-strong': '224 47 31', // #e02f1f
  'rgb-status-neutral': '82 104 106', // #52686A (Secondary Text)
  'rgb-status-neutral-subtle': '232 243 240', // #E8F3F0 (Mist)
  'rgb-status-neutral-border': '200 218 214', // #C8DAD6
  'rgb-text-on-status': '255 255 255', // #FFFFFF

  // Brand colors
  'rgb-brand-purple': '155 138 251', // #9B8AFB (Soft Orchid)

  /** Code syntax highlighting, measured against the `surface-code` fill. */
  'rgb-syntax-text': '16 42 45', // #102A2D
  'rgb-syntax-comment': '110 127 128', // #6E7F80
  'rgb-syntax-meta': '82 104 106', // #52686A
  'rgb-syntax-builtin': '154 103 0', // #9a6700
  'rgb-syntax-keyword': '8 127 131', // #087F83 (Baanzon Teal)
  'rgb-syntax-string': '10 123 98', // #0a7b62
  'rgb-syntax-attr': '155 138 251', // #9B8AFB (Soft Orchid)
  'rgb-syntax-title': '180 35 24', // #b42318

  /** Categorical series scale. CVD-safe, Baanzon Aurora-stepped. */
  'rgb-series-1': '8 127 131', // #087F83 (Baanzon Teal)
  'rgb-series-2': '233 86 13', // #e9560d (orange)
  'rgb-series-3': '53 214 199', // #35D6C7 (Luminous Aqua)
  'rgb-series-4': '182 123 5', // #b67b05 (amber)
  'rgb-series-5': '155 138 251', // #9B8AFB (Soft Orchid)
  'rgb-series-6': '216 194 157', // #D8C29D (Champagne)
  'rgb-series-7': '4 120 87', // #047857 (green-700)

  /** Unchecked switch track. 3.03:1 against the white canvas. */
  'rgb-switch-unchecked': '160 185 180', // #A0B9B4

  // Presentation
  'rgb-presentation': '255 255 255', // #FFFFFF
};
