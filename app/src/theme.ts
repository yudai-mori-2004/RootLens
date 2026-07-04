// RootLens design system — "Editorial Fintech".
//
// Inspired by the Week 5 pitch illustrations: navy outline + emerald accent on
// warm cream, with hairline borders and confident typography. Pairs Fraunces
// (serif display) with Inter (sans body) and Menlo (mono readouts).
//
// Aesthetic intent:
//   • Confident, quiet authority — evokes a Japanese design studio (Karte / SmartHR)
//     more than a SaaS template
//   • Generous whitespace, hairline rules, occasional sparks of color for value
//   • Surfaces feel papery; ink is heavy navy; success / value is forest-emerald

import { Platform } from 'react-native';

// ── Palette ──────────────────────────────────────────────────────────────
// Surfaces and chrome. `paper` is the dominant warm cream, `card` is the
// clean white that floats above it. `inkSoft` is a navy tone for hover/press.
export const colors = {
  // Surfaces
  paper: '#F8F4ED',          // dominant warm cream
  paperDeep: '#F0EBE0',      // deeper paper for inset cards
  card: '#FFFFFF',           // clean surface that floats above paper
  ink: '#0E1F44',            // primary navy — the line color in illustrations
  inkSoft: '#1B2D5A',        // pressed / hover navy
  inkMute: '#4F5F7E',        // navy at lower priority
  scrim: 'rgba(14, 31, 68, 0.55)',  // overlay scrim for camera / modal

  // Text
  textInk: '#0E1F44',
  textBody: '#1B2D5A',
  textMute: '#5C6B85',
  textFaint: '#94A0B5',
  textOnInk: '#F8F4ED',

  // Accent — emerald from illustrations
  emerald: '#1FA679',
  emeraldDeep: '#157C5A',
  emeraldSoft: '#E2F4ED',
  emeraldFaint: '#F0F9F4',

  // Highlight — gold spark from token graphics
  gold: '#E8B339',
  goldSoft: '#FAEFD0',

  // Borders / hairlines
  border: '#E6DFD0',         // warm hairline that fits paper
  borderInk: '#0E1F44',
  borderEmerald: '#A5DBC4',

  // Status (kept restrained so they don't fight emerald accent)
  success: '#1FA679',
  successSoft: '#E2F4ED',
  warn: '#B7741A',
  warnSoft: '#FAE7C4',
  danger: '#B23A2E',
  dangerSoft: '#F4DCD7',
  recording: '#B23A2E',

  // Legacy aliases (existing screens still reference these — kept until refactor)
  background: '#F8F4ED',     // = paper
  surface: '#FFFFFF',        // = card
  surfaceAlt: '#F0EBE0',     // = paperDeep
  textPrimary: '#0E1F44',
  textSecondary: '#5C6B85',
  textHint: '#94A0B5',
  textDisabled: '#BDC4D2',
  borderLight: '#F0EBE0',
  accent: '#0E1F44',         // primary CTA = ink (was navy)
  accentLight: '#E2F4ED',    // = emeraldSoft
  accentDark: '#1B2D5A',     // = inkSoft
  error: '#B23A2E',          // = danger
  errorLight: '#F4DCD7',     // = dangerSoft
  black: '#000000',
  white: '#FFFFFF',
  overlayLight: 'rgba(14,31,68,0.10)',
  overlayMedium: 'rgba(14,31,68,0.42)',
  overlayDark: 'rgba(14,31,68,0.65)',
  overlayCrop: 'rgba(14,31,68,0.55)',
  overlayWhiteFaint: 'rgba(255,255,255,0.08)',
  overlayWhiteSubtle: 'rgba(255,255,255,0.10)',
  overlayWhite: 'rgba(255,255,255,0.15)',
  overlayWhiteGrid: 'rgba(255,255,255,0.25)',
  overlayWhiteMask: 'rgba(255,255,255,0.30)',
  overlayWhiteLine: 'rgba(255,255,255,0.40)',
  overlayWhiteHalf: 'rgba(255,255,255,0.50)',
  overlayWhiteFrame: 'rgba(255,255,255,0.70)',
  darkBg: '#000000',
  darkText: '#F8F4ED',
  darkTextSecondary: '#AAB6CC',
  darkTextDisabled: '#5A647A',
  darkSeparator: 'rgba(255,255,255,0.20)',
  borderStrong: '#CBC2AE',
  successLight: '#E2F4ED',
  statusOk: '#1FA679',
  statusWarn: '#B7741A',
  statusError: '#B23A2E',
  bgInk: '#0E1F44',
  bgInkSoft: '#1B2D5A',
} as const;

// ── Typography ─────────────────────────────────────────────────────────
// Two display families (Fraunces serif + Inter sans), one mono.
export const fonts = {
  // Fraunces (variable serif): used for headings, hero numerals, task names.
  // Loaded in App.tsx via @expo-google-fonts/fraunces.
  serifLight: 'Fraunces_300Light',
  serifRegular: 'Fraunces_400Regular',
  serifMedium: 'Fraunces_500Medium',
  serifSemibold: 'Fraunces_600SemiBold',
  serifBold: 'Fraunces_700Bold',

  // Inter: body, UI chrome, secondary labels. Loaded via @expo-google-fonts/inter.
  sansRegular: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',

  // System monospace for tx hashes, price chips, code-like readouts.
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'Menlo' })!,
} as const;

export const typography = {
  // Display (Fraunces)
  display1: { fontFamily: fonts.serifLight, fontSize: 44, lineHeight: 50, letterSpacing: -0.6 },
  display2: { fontFamily: fonts.serifRegular, fontSize: 32, lineHeight: 38, letterSpacing: -0.4 },
  display3: { fontFamily: fonts.serifMedium, fontSize: 24, lineHeight: 30, letterSpacing: -0.2 },
  // Title — used for screen headers and card titles
  title: { fontFamily: fonts.serifMedium, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  titleSans: { fontFamily: fonts.sansSemibold, fontSize: 17, lineHeight: 24, letterSpacing: -0.1 },
  // Body
  body: { fontFamily: fonts.sansRegular, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 22 },
  // Caption
  caption: { fontFamily: fonts.sansRegular, fontSize: 13, lineHeight: 18 },
  captionMedium: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 18 },
  // Labels (caps-track for section headers and chips)
  label: {
    fontFamily: fonts.sansSemibold, fontSize: 11, lineHeight: 14,
    letterSpacing: 1.4, textTransform: 'uppercase' as const,
  },
  labelSmall: {
    fontFamily: fonts.sansSemibold, fontSize: 10, lineHeight: 14,
    letterSpacing: 1.6, textTransform: 'uppercase' as const,
  },
  // Mono — readouts, hashes, prices
  mono: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 0.2 },
  monoLg: { fontFamily: fonts.mono, fontSize: 14, letterSpacing: 0.2 },
  // legacy aliases used by older screens
  heading: { fontFamily: fonts.serifMedium, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  small: { fontFamily: fonts.sansSemibold, fontSize: 10, lineHeight: 14, letterSpacing: 1.6 },
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
} as const;

export const radii = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 18,
  xxl: 24,
  full: 9999,
} as const;

export const shadows = {
  // Warm, soft float — cards lifting off warm paper (warm-toned shadow, not cold navy).
  card: {
    shadowColor: '#33271A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  // More pronounced — for modal / popover
  pop: {
    shadowColor: '#0E1F44',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  // legacy aliases
  sm: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 2, elevation: 2,
  },
  md: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 4, elevation: 4,
  },
  lg: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  },
} as const;

// React Navigation header — paper background, navy text, no shadow.
export const navigationHeaderOptions = {
  headerStyle: { backgroundColor: colors.paper },
  headerTintColor: colors.ink,
  headerTitleStyle: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    color: colors.ink,
  },
  headerShadowVisible: false,
  headerBackTitleVisible: false,
} as const;

// Header style helper for hand-rolled headers (in screens that hide nav header).
export const headerStyle = {
  height: 52,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'space-between' as const,
  paddingHorizontal: spacing.lg,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
};
