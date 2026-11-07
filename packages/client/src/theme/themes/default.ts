import { IThemeRGB } from '../types';

/**
 * Baanzon Gunmetal Pearl — Light Theme
 * Cool paper on graphite, velvet iris accents.
 */
export const defaultTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '23 23 28', // #17171C (Primary Text)
  'rgb-text-secondary': '82 82 94', // #52525E (Secondary Text)
  'rgb-text-secondary-alt': '107 107 117', // #6B6B75 (Muted Text, WCAG AA)
  'rgb-text-tertiary': '107 107 117', // #6B6B75 (Muted Text, WCAG AA)
  'rgb-text-muted': '107 107 117', // #6B6B75 (Muted Text, WCAG AA)
  'rgb-text-warning': '180 83 9', // #b45309 (amber-700)
  'rgb-text-destructive': '217 40 56', // #d92838 (Velvet Red)
  'rgb-shimmer-base': '23 23 28', // #17171C, matching text-primary
  'rgb-shimmer-dip': '131 131 143', // #83838F

  // Link and accent colors
  'rgb-link': '91 75 212', // #5B4BD4 (Velvet Iris)
  'rgb-link-hover': '74 59 191', // #4A3BBF (Iris darker)
  'rgb-link-visited': '106 62 200', // #6A3EC8 (Iris visited)
  'rgb-accent-primary': '109 92 230', // #6D5CE6 (Velvet Iris)
  'rgb-accent-primary-hover': '91 75 212', // #5B4BD4 (Iris darker)

  // Ring colors
  'rgb-ring-primary': '109 92 230', // #6D5CE6 (Velvet Iris)

  // Header colors
  'rgb-header-primary': '255 255 255', // #fff (white)
  'rgb-header-hover': '250 250 252', // #FAFAFC (paper background)
  'rgb-header-button-hover': '250 250 252', // #FAFAFC (paper background)

  // Surface colors
  'rgb-surface-active': '239 239 244', // #EFEFF4
  'rgb-surface-active-alt': '228 228 234', // #E4E4EA (Border)
  'rgb-surface-hover': '239 239 244', // #EFEFF4
  'rgb-surface-hover-alt': '228 228 234', // #E4E4EA (Border)
  'rgb-surface-composer-hover': '239 239 244', // #EFEFF4
  'rgb-surface-primary': '255 255 255', // #FFFFFF (Surface)
  'rgb-chart-widget-surface': '255 255 255', // #FFFFFF
  'rgb-chart-widget-stroke': '228 228 234', // #E4E4EA (Border)
  'rgb-surface-primary-alt': '250 250 252', // #FAFAFC (Paper background)
  'rgb-surface-primary-contrast': '239 239 244', // #EFEFF4
  'rgb-surface-secondary': '246 246 249', // #F6F6F9
  'rgb-surface-secondary-alt': '240 240 244', // #F0F0F4
  'rgb-surface-tertiary': '239 239 244', // #EFEFF4
  'rgb-surface-tertiary-alt': '255 255 255', // #FFFFFF (Surface)
  'rgb-surface-dialog': '255 255 255', // #FFFFFF (Surface)
  'rgb-surface-overlay': '23 23 28', // #17171C (overlay)
  'rgb-surface-submit': '109 92 230', // #6D5CE6 (Velvet Iris)
  'rgb-surface-submit-hover': '91 75 212', // #5B4BD4 (Iris darker)
  'rgb-surface-destructive': '178 24 40', // #b21828
  'rgb-surface-destructive-hover': '143 18 32', // #8f1220
  'rgb-surface-chat': '255 255 255', // #FFFFFF (Surface)
  'rgb-surface-code': '250 250 252', // #FAFAFC (Paper background)
  'rgb-surface-inverted': '23 23 28', // #17171C (Graphite)
  'rgb-surface-inverted-hover': '91 75 212', // #5B4BD4 (Iris)
  'rgb-text-inverted': '255 255 255', // #FFFFFF
  'rgb-surface-fixed': '255 255 255', // #FFFFFF
  'rgb-surface-fixed-hover': '239 239 244', // #EFEFF4
  'rgb-text-fixed': '23 23 28', // #17171C

  // Border colors
  'rgb-border-light': '228 228 234', // #E4E4EA (Border)
  'rgb-border-medium': '211 211 219', // #D3D3DB (darker border)
  'rgb-border-medium-alt': '211 211 219', // #D3D3DB
  'rgb-border-heavy': '173 173 185', // #ADADB9 (heavy border)
  'rgb-border-xheavy': '131 131 143', // #83838F (Muted)
  'rgb-border-destructive': '217 40 56', // #d92838

  // Status colors
  'rgb-status-success': '4 120 87', // #047857 (green-700)
  'rgb-status-success-subtle': '232 246 239', // #ECF6EF (green-tinted paper)
  'rgb-status-success-border': '110 231 183', // #6ee7b7 (green-300)
  'rgb-status-success-strong': '2 133 94', // #02855e
  'rgb-status-info': '7 121 125', // #07797D (Baanzon Teal, stepped for the Mist fill)
  'rgb-status-info-subtle': '228 242 242', // #E4F2F2
  'rgb-status-info-border': '106 198 204', // #6AC6CC
  'rgb-status-info-strong': '7 121 125', // #07797D
  'rgb-status-warning': '180 83 9', // #b45309 (amber-700)
  'rgb-status-warning-subtle': '255 251 235', // #fffbeb (amber-50)
  'rgb-status-warning-border': '252 211 77', // #fcd34d (amber-300)
  'rgb-status-warning-strong': '180 83 9', // #b45309
  'rgb-status-error': '178 24 40', // #b21828
  'rgb-status-error-subtle': '254 242 244', // #fef2f4
  'rgb-status-error-border': '255 154 165', // #FF9AA5
  'rgb-status-error-strong': '217 40 56', // #d92838
  'rgb-status-neutral': '82 82 94', // #52525E (Secondary Text)
  'rgb-status-neutral-subtle': '239 239 244', // #EFEFF4
  'rgb-status-neutral-border': '211 211 219', // #D3D3DB
  'rgb-text-on-status': '255 255 255', // #FFFFFF

  // Brand colors
  'rgb-brand-purple': '155 138 251', // #9B8AFB (Soft Orchid)

  /** Code syntax highlighting, measured against the `surface-code` fill. */
  'rgb-syntax-text': '23 23 28', // #17171C
  'rgb-syntax-comment': '131 131 143', // #83838F
  'rgb-syntax-meta': '82 82 94', // #52525E
  'rgb-syntax-builtin': '154 103 0', // #9a6700
  'rgb-syntax-keyword': '91 75 212', // #5B4BD4 (Velvet Iris)
  'rgb-syntax-string': '14 122 100', // #0E7A64 (Deep Teal)
  'rgb-syntax-attr': '109 92 230', // #6D5CE6 (Velvet Iris)
  'rgb-syntax-title': '190 18 60', // #BE123C (Rose)

  /** Categorical series scale. CVD-safe, slot order is the mechanism. */
  'rgb-series-1': '28 111 232', // #1C6FE8 (Sky)
  'rgb-series-2': '232 89 12', // #E8590C (Orange)
  'rgb-series-3': '14 148 136', // #0E9488 (Teal-green, WCAG-compliant)
  'rgb-series-4': '184 116 2', // #B87402 (Amber, WCAG-compliant)
  'rgb-series-5': '109 92 230', // #6D5CE6 (Velvet Iris, WCAG-compliant)
  'rgb-series-6': '140 106 47', // #8C6A2F (Umber, WCAG-compliant)
  'rgb-series-7': '162 28 175', // #A21CAF (Fuchsia)

  /** Unchecked switch track. 3.74:1 against white surface (#FFFFFF). */
  'rgb-switch-unchecked': '131 131 143', // #83838F

  // Presentation
  'rgb-presentation': '255 255 255', // #FFFFFF
};
