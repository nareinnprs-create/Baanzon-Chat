import { IThemeRGB } from '../types';

/**
 * Baanzon Velvet Nocturne — Dark Theme
 * Graphite canvases, quiet light-on-dark borders, velvet iris accents.
 */
export const darkTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '245 245 247', // #F5F5F7 (Primary Text)
  'rgb-text-secondary': '161 161 170', // #A1A1AA (Secondary Text)
  'rgb-text-secondary-alt': '148 148 159', // #94949F (Muted Text, WCAG AA)
  'rgb-text-tertiary': '148 148 159', // #94949F (Muted Text, WCAG AA)
  'rgb-text-muted': '110 110 121', // #6E6E79
  'rgb-text-warning': '252 211 77', // #fcd34d (amber-300)
  'rgb-text-destructive': '255 92 108', // #FF5C6C (Velvet Red)
  'rgb-shimmer-base': '245 245 247', // #F5F5F7, carried at 0.8 alpha
  'rgb-shimmer-dip': '92 92 102', // #5C5C66

  // Link and accent colors
  'rgb-link': '169 154 255', // #A99AFF (Iris, stepped for graphite)
  'rgb-link-hover': '196 182 255', // #C4B6FF (Iris brighter)
  'rgb-link-visited': '234 217 255', // #EAD9FF (Champagne)
  'rgb-accent-primary': '142 124 255', // #8E7CFF (Velvet Iris)
  'rgb-accent-primary-hover': '169 154 255', // #A99AFF

  // Ring colors
  'rgb-ring-primary': '142 124 255', // #8E7CFF (Velvet Iris)

  // Header colors
  'rgb-header-primary': '21 21 27', // #15151B (Elevated surface)
  'rgb-header-hover': '28 28 35', // #1C1C23 (Surface hover)
  'rgb-header-button-hover': '21 21 27', // #15151B

  // Surface colors
  'rgb-surface-active': '36 36 44', // #24242C
  'rgb-surface-active-alt': '21 21 27', // #15151B
  'rgb-surface-hover': '28 28 35', // #1C1C23
  'rgb-surface-hover-alt': '36 36 44', // #24242C
  'rgb-surface-composer-hover': '28 28 35', // #1C1C23
  'rgb-surface-primary': '11 11 15', // #0B0B0F (Background)
  'rgb-chart-widget-surface': '21 21 27', // #15151B
  'rgb-chart-widget-stroke': '35 35 41', // #232329 (Border)
  'rgb-surface-primary-alt': '21 21 27', // #15151B
  'rgb-surface-primary-contrast': '28 28 35', // #1C1C23
  'rgb-surface-secondary': '21 21 27', // #15151B
  'rgb-surface-secondary-alt': '28 28 35', // #1C1C23
  'rgb-surface-tertiary': '28 28 35', // #1C1C23
  'rgb-surface-tertiary-alt': '28 28 35', // #1C1C23
  'rgb-surface-dialog': '21 21 27', // #15151B
  'rgb-surface-overlay': '0 0 0', // #000 (black)
  'rgb-surface-submit': '142 124 255', // #8E7CFF (Velvet Iris)
  'rgb-surface-submit-hover': '169 154 255', // #A99AFF
  'rgb-surface-destructive': '143 18 32', // #8f1220
  'rgb-surface-destructive-hover': '118 14 28', // #760e1c
  'rgb-surface-chat': '21 21 27', // #15151B
  'rgb-surface-code': '21 21 27', // #15151B
  'rgb-surface-inverted': '245 245 247', // #F5F5F7 (Primary Text)
  'rgb-surface-inverted-hover': '161 161 170', // #A1A1AA
  'rgb-text-inverted': '11 11 15', // #0B0B0F (Background)
  'rgb-surface-fixed': '245 245 247', // #F5F5F7
  'rgb-surface-fixed-hover': '161 161 170', // #A1A1AA
  'rgb-text-fixed': '11 11 15', // #0B0B0F

  // Border colors
  'rgb-border-light': '35 35 41', // #232329 (Border)
  'rgb-border-medium': '46 46 54', // #2E2E36
  'rgb-border-medium-alt': '46 46 54', // #2E2E36
  'rgb-border-heavy': '58 58 69', // #3A3A45 (heavier border)
  'rgb-border-xheavy': '91 91 104', // #5B5B68
  'rgb-border-destructive': '243 68 86', // #F34456

  // Status colors
  'rgb-status-success': '74 222 128', // #4ADE80
  'rgb-status-success-subtle': '13 42 26', // #0D2A1A
  'rgb-status-success-border': '22 101 52', // #166534
  'rgb-status-success-strong': '74 222 128', // #4ADE80
  'rgb-status-info': '120 217 255', // #78D9FF
  'rgb-status-info-subtle': '11 42 61', // #0B2A3D
  'rgb-status-info-border': '46 122 160', // #2E7AA0
  'rgb-status-info-strong': '120 217 255', // #78D9FF
  'rgb-status-warning': '252 211 77', // #fcd34d (amber-300)
  'rgb-status-warning-subtle': '42 33 6', // #2A2106
  'rgb-status-warning-border': '146 64 14', // #92400e (amber-800)
  'rgb-status-warning-strong': '146 64 14', // #92400e
  'rgb-status-error': '255 154 165', // #FF9AA5
  'rgb-status-error-subtle': '56 16 23', // #381017
  'rgb-status-error-border': '143 18 32', // #8f1220
  'rgb-status-error-strong': '143 18 32', // #8f1220
  'rgb-status-neutral': '161 161 170', // #A1A1AA
  'rgb-status-neutral-subtle': '21 21 27', // #15151B
  'rgb-status-neutral-border': '35 35 41', // #232329
  'rgb-text-on-status': '11 11 15', // #0B0B0F (dark text on light status)

  // Brand colors
  'rgb-brand-purple': '183 165 255', // #B7A5FF (Iris)

  /** Code syntax highlighting, measured against the `surface-code` fill. */
  'rgb-syntax-text': '245 245 247', // #F5F5F7
  'rgb-syntax-comment': '142 142 154', // #8E8E9A
  'rgb-syntax-meta': '161 161 170', // #A1A1AA
  'rgb-syntax-builtin': '216 194 157', // #D8C29D (Champagne)
  'rgb-syntax-keyword': '183 165 255', // #B7A5FF (Iris)
  'rgb-syntax-string': '155 208 255', // #9BD0FF (Sky)
  'rgb-syntax-attr': '196 176 255', // #C4B0FF (Iris)
  'rgb-syntax-title': '255 154 165', // #FF9AA5

  /** Categorical series scale — slot order is the CVD-safety mechanism. */
  'rgb-series-1': '56 189 248', // #38BDF8 (Sky)
  'rgb-series-2': '255 159 107', // #FF9F6B (Peach)
  'rgb-series-3': '53 214 199', // #35D6C7 (Aqua)
  'rgb-series-4': '216 194 157', // #D8C29D (Champagne)
  'rgb-series-5': '169 154 255', // #A99AFF (Velvet Iris)
  'rgb-series-6': '20 184 166', // #14B8A6 (Teal)
  'rgb-series-7': '163 230 53', // #A3E635 (Lime)

  /** Unchecked switch track. 3.3:1 against background (#0B0B0F). */
  'rgb-switch-unchecked': '99 99 111', // #63636F

  // Presentation
  'rgb-presentation': '21 21 27', // #15151B
};
