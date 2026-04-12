import { ITheme } from './types';

export const theme: ITheme = {
  colors: {
    primary:   '#0891B2',
    secondary: '#0369A1',
    success:   '#065F46',
    warning:   '#92400E',
    error:     '#991B1B',
    dim:       '#6B7280',
    muted:     '#9CA3AF',
  },
  icons: {
    success:   '✔',
    error:     '✘',
    warning:   '⚠',
    info:      'ℹ',
    arrow:     '›',
    bullet:    '●',
    circle:    '○',
    star:      '★',
    analyzing: '◆',
  },
} as const;

// ─── Light palette (dark text on light/white terminal bg) ────────────────────

const lightPalette = {
  brand:     '#0891B2',
  brandDark: '#0E7490',

  emerald:   '#065F46',
  amber:     '#92400E',
  rose:      '#991B1B',

  badgeHigh: '#059669',
  badgeMed:  '#D97706',
  badgeLow:  '#DC2626',
  badgeText: '#FFFFFF',

  text:      '#111827',
  sub:       '#374151',
  dim:       '#6B7280',
  muted:     '#9CA3AF',

  border:    '#4B5563',   // Gray-600 — clearly visible on white
  borderSub: '#9CA3AF',   // Gray-400 — inner dividers, softer
  cyan:      '#0369A1',
  barFill:   '#0891B2',
  barEmpty:  '#D1D5DB',
};

// ─── Dark palette (light text on dark terminal bg) ───────────────────────────

const darkPalette = {
  brand:     '#22D3EE',   // Cyan-400 — bright teal on dark bg
  brandDark: '#06B6D4',   // Cyan-500

  emerald:   '#34D399',   // Emerald-400 — HIGH confidence
  amber:     '#FBBF24',   // Amber-400 — MED confidence
  rose:      '#F87171',   // Red-400 — LOW confidence / errors

  badgeHigh: '#059669',   // Emerald-600 — badge bg (solid)
  badgeMed:  '#D97706',   // Amber-600
  badgeLow:  '#DC2626',   // Red-600
  badgeText: '#FFFFFF',

  text:      '#F9FAFB',   // Near-white — primary content
  sub:       '#E5E7EB',   // Gray-200 — labels
  dim:       '#9CA3AF',   // Gray-400 — de-emphasized
  muted:     '#6B7280',   // Gray-500 — hints

  border:    '#4B5563',   // Gray-600 — panel outer border
  borderSub: '#374151',   // Gray-700 — inner dividers
  cyan:      '#38BDF8',   // Sky-400 — filenames
  barFill:   '#22D3EE',   // Cyan-400
  barEmpty:  '#374151',   // Gray-700
};

export type ThemeName = 'light' | 'dark';

// ─── Mutable active palette (defaults to dark) ───────────────────────────────
// Exported as a plain object so existing `import { palette }` statements
// receive a reference — Object.assign patches it in place and all consumers
// see the new values immediately.

export const palette: typeof darkPalette = { ...darkPalette };

export function setTheme(t: ThemeName): void {
  const source = t === 'light' ? lightPalette : darkPalette;
  Object.assign(palette, source);
}

export function getThemeName(): ThemeName {
  // Detect by comparing a dark-only color
  return palette.text === darkPalette.text ? 'dark' : 'light';
}

// ─── Color helpers ────────────────────────────────────────────────────────────

export function confidenceColor(confidence: string): string {
  switch (confidence) {
    case 'high':   return palette.emerald;
    case 'medium': return palette.amber;
    case 'low':    return palette.rose;
    default:       return palette.dim;
  }
}

export function confidenceBadgeBg(confidence: string): string {
  switch (confidence) {
    case 'high':   return palette.badgeHigh;
    case 'medium': return palette.badgeMed;
    case 'low':    return palette.badgeLow;
    default:       return palette.dim;
  }
}

export function scorerBarColor(confidence: string): string {
  return confidenceColor(confidence);
}
