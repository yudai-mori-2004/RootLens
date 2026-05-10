// Sandbox 04 (production-bound collection flow) — design tokens.
//
// Aesthetic: Swiss precision instrument. Editorial whitespace, hairline borders,
// refined typography hierarchy. White-based with navy ink accents (matches RootLens brand).
// Numerical readouts (timer, latency, FPS) in monospace for tabular alignment.

import { Platform } from 'react-native';

export const colors = {
  // Surfaces
  bgWarm: '#fafaf7',        // page background — warm off-white
  bgWhite: '#ffffff',       // card / surface
  bgInk: '#0a1f44',         // navy ink — primary brand
  bgInkSoft: '#13284e',     // hover / secondary navy
  bgScrim: 'rgba(250, 250, 247, 0.94)',   // light scrim over camera
  bgScrimDark: 'rgba(10, 31, 68, 0.82)',  // navy scrim

  // Text
  textInk: '#0a1f44',
  textBody: '#1a2940',
  textMute: '#5a6b7c',
  textFaint: '#8a96a3',
  textOnInk: '#fafaf7',

  // Borders / hairlines
  border: '#e5e1d8',        // warm hairline
  borderStrong: '#cdc7bb',
  borderInk: '#0a1f44',

  // Status (tonal — designed to coexist with navy)
  statusOk: '#1a7c47',      // deep emerald
  statusOkSoft: '#e8f3ed',
  statusWarn: '#92500c',    // amber
  statusError: '#a94e3c',   // rust
  statusErrorSoft: '#f4e4df',

  // Camera-overlay accents
  recDot: '#a94e3c',
};

// Font family. Fraunces (variable serif) for display, system sans for body, Menlo (mono) for readouts.
export const fonts = {
  displayLight: 'Fraunces_300Light',
  displayRegular: 'Fraunces_400Regular',
  displayMedium: 'Fraunces_500Medium',
  displaySemibold: 'Fraunces_600SemiBold',
  // body は system default を使う (iOS: SF Pro, Android: Roboto)
  body: undefined as undefined,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'Menlo' })!,
};

export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
};

export const radius = {
  none: 0,
  s: 4,
  m: 8,
  l: 12,
  pill: 999,
};

export const type = {
  // Display: serif, used for hero headlines + numerals
  display1: { fontFamily: fonts.displayLight, fontSize: 44, lineHeight: 50, letterSpacing: -0.6 },
  display2: { fontFamily: fonts.displayRegular, fontSize: 32, lineHeight: 38, letterSpacing: -0.4 },
  display3: { fontFamily: fonts.displayMedium, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },

  // Caps: tracked uppercase labels (section heads, status)
  caps: { fontSize: 11, letterSpacing: 1.6, fontWeight: '600' as const },
  capsS: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600' as const },

  // Body
  bodyL: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  bodyS: { fontSize: 12, lineHeight: 18, fontWeight: '400' as const },

  // Mono: tabular numerical readouts
  mono: { fontFamily: fonts.mono, fontSize: 13, letterSpacing: 0.4 },
  monoS: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.4 },
};

// Hairline border helper (1px, no shadow)
export const hairline = (side: 'top' | 'bottom' | 'all' = 'all') => {
  const w = { borderColor: colors.border };
  if (side === 'top') return { borderTopWidth: 1, ...w };
  if (side === 'bottom') return { borderBottomWidth: 1, ...w };
  return { borderWidth: 1, ...w };
};
