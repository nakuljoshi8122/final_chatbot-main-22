/**
 * Liquid Glass design tokens — the single source of truth for the app's
 * translucent, layered "liquid glass" look (frosted surfaces, soft aurora
 * backdrops, hairline highlights, deep rounded corners).
 *
 * Light glass = frosted white panes floating over a pastel aurora.
 * Dark glass  = smoked panes floating over a deep midnight aurora.
 */
import { Platform } from 'react-native';

export const Glass = {
  /** Aurora backdrop gradients (top-left -> bottom-right). */
  aurora: {
    light: ['#EAF2FF', '#F6EDFF', '#FFEFF4', '#EFF8F2'] as const,
    dark: ['#0B1020', '#141A2E', '#1B1430', '#0E1B24'] as const,
  },

  /** Frosted pane fills (layer translucency over the aurora). */
  fill: {
    light: 'rgba(255,255,255,0.62)',
    lightStrong: 'rgba(255,255,255,0.82)',
    lightSoft: 'rgba(255,255,255,0.42)',
    dark: 'rgba(22,24,38,0.58)',
    darkStrong: 'rgba(26,28,44,0.82)',
    darkSoft: 'rgba(30,32,50,0.40)',
  },

  /** Hairline borders that read as the glass edge catching light. */
  stroke: {
    light: 'rgba(255,255,255,0.65)',
    lightOuter: 'rgba(120,130,160,0.22)',
    dark: 'rgba(255,255,255,0.14)',
    darkOuter: 'rgba(255,255,255,0.08)',
  },

  /** Text on glass. */
  ink: {
    light: '#101425',
    lightSecondary: 'rgba(24,30,54,0.74)',
    lightTertiary: 'rgba(24,30,54,0.55)',
    dark: '#F4F6FF',
    darkSecondary: 'rgba(235,240,255,0.66)',
    darkTertiary: 'rgba(235,240,255,0.42)',
  },

  /** Accent tints kept saturated so they glow through the frost. */
  tint: {
    blue: '#3D7BFF',
    indigo: '#6A5BFF',
    teal: '#2BB8A8',
    pink: '#F0619E',
    amber: '#F2A93B',
    red: '#FF5A5F',
    green: '#34C77B',
  },

  /** Blur intensities for expo-blur BlurView. */
  blur: {
    subtle: 18,
    regular: 36,
    strong: 60,
  },

  /** Corner radii — liquid glass loves deep, continuous curves. */
  radius: {
    xs: 10,
    sm: 14,
    md: 18,
    lg: 24,
    xl: 30,
    pill: 999,
  },

  /** Soft ambient shadow for floating panes. */
  shadow: Platform.select({
    ios: {
      shadowColor: '#1B2559',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.14,
      shadowRadius: 24,
    },
    default: { elevation: 6 },
  }) as object,

  shadowSoft: Platform.select({
    ios: {
      shadowColor: '#1B2559',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
    },
    default: { elevation: 3 },
  }) as object,
} as const;

export type GlassScheme = 'light' | 'dark';
