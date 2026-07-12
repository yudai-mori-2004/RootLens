// RootLens design system — "Film Studio" (Dark Cinema).
//
// カメラアプリらしい炭色の闇に、 琥珀のアクセント。 動画サムネイルが一番美しく浮く。
// 日本語は M PLUS 1、 時刻・尺の読み出しは JetBrains Mono。
//
// Aesthetic intent:
//   • 撮影スタジオの照明を落とした空気 — 主役は映像、 UI は黒子
//   • hairline は炭上のわずかな明度差、 アクセントは琥珀 1 色
//   • 数値 (時刻 / 尺 / 容量) は mono で「機材の読み出し」 感を出す

import { Platform } from 'react-native';

// ── Palette ──────────────────────────────────────────────────────────────
// Surfaces and chrome. `paper` is the dominant warm cream, `card` is the
// clean white that floats above it. `inkSoft` is a navy tone for hover/press.
export const colors = {
  // Surfaces
  paper: '#131519',          // dominant charcoal (= スタジオの闇)
  paperDeep: '#1B1E24',      // inset surface
  card: '#1C2027',           // raised surface
  ink: '#F0EDE6',            // primary light text (= warm white)
  inkSoft: '#FFFFFF',
  inkMute: '#B9BDC6',
  scrim: 'rgba(6, 7, 9, 0.6)',

  // Text
  textInk: '#F0EDE6',
  textBody: '#C7CAD1',
  textMute: '#878C98',
  textFaint: '#565B66',
  textOnInk: '#131519',

  // Accent — 琥珀 (= タングステン照明)
  emerald: '#E8A33D',
  emeraldDeep: '#C9822A',
  emeraldSoft: '#33291A',
  emeraldFaint: '#241F15',

  // Highlight
  gold: '#E8B339',
  goldSoft: '#332B18',

  // Accent — LP (= rootlens.io の neon zine の差し色。 面ではなく点で使う:
  // primary CTA = pink、 進捗 = lime、 ワードマークの Lens = yellow)
  lpPink: '#FF2E93',
  lpLime: '#C8FF00',
  lpYellow: '#FFE600',

  // Borders / hairlines
  border: '#282C35',
  borderInk: '#F0EDE6',
  borderEmerald: '#6B5426',

  // Status
  success: '#57B98A',
  successSoft: '#1D2B24',
  warn: '#D99A3D',
  warnSoft: '#2F2718',
  danger: '#E05548',
  dangerSoft: '#33201D',
  recording: '#E05548',

  // Legacy aliases (existing screens still reference these — kept until refactor)
  background: '#131519',
  surface: '#1C2027',
  surfaceAlt: '#1B1E24',
  textPrimary: '#F0EDE6',
  textSecondary: '#878C98',
  textHint: '#565B66',
  textDisabled: '#3E434D',
  borderLight: '#22252D',
  accent: '#E8A33D',
  accentLight: '#33291A',
  accentDark: '#C9822A',
  error: '#E05548',
  errorLight: '#33201D',
  black: '#000000',
  white: '#FFFFFF',
  overlayLight: 'rgba(240,237,230,0.08)',
  overlayMedium: 'rgba(6,7,9,0.42)',
  overlayDark: 'rgba(6,7,9,0.65)',
  overlayCrop: 'rgba(6,7,9,0.55)',
  overlayWhiteFaint: 'rgba(255,255,255,0.08)',
  overlayWhiteSubtle: 'rgba(255,255,255,0.10)',
  overlayWhite: 'rgba(255,255,255,0.15)',
  overlayWhiteGrid: 'rgba(255,255,255,0.25)',
  overlayWhiteMask: 'rgba(255,255,255,0.30)',
  overlayWhiteLine: 'rgba(255,255,255,0.40)',
  overlayWhiteHalf: 'rgba(255,255,255,0.50)',
  overlayWhiteFrame: 'rgba(255,255,255,0.70)',
  darkBg: '#000000',
  darkText: '#F0EDE6',
  darkTextSecondary: '#AAB0BC',
  darkTextDisabled: '#5A5F6B',
  darkSeparator: 'rgba(255,255,255,0.20)',
  borderStrong: '#3A3F4A',
  successLight: '#1D2B24',
  statusOk: '#57B98A',
  statusWarn: '#D99A3D',
  statusError: '#E05548',
  bgInk: '#0B0C0F',
  bgInkSoft: '#16181D',
} as const;

// ── Typography ─────────────────────────────────────────────────────────
// Two display families (Fraunces serif + Inter sans), one mono.
export const fonts = {
  // 表示 (= 見出し / ヒーロー数値)。 M PLUS 1 は日本語を含む。
  serifLight: 'MPLUS1_300Light',
  serifRegular: 'MPLUS1_400Regular',
  serifMedium: 'MPLUS1_500Medium',
  serifSemibold: 'MPLUS1_700Bold',
  serifBold: 'MPLUS1_800ExtraBold',

  // 本文 / UI
  sansRegular: 'MPLUS1_400Regular',
  sansMedium: 'MPLUS1_500Medium',
  sansSemibold: 'MPLUS1_700Bold',
  sansBold: 'MPLUS1_800ExtraBold',

  // 読み出し (= 時刻 / 尺 / hash)
  mono: 'JetBrainsMono_500Medium',

  // 録画 HUD の数字 / インジケータ (= LP のドット文字 DotGothic16。 日本語グリフも持つ)
  dot: 'DotGothic16_400Regular',

  // ブランドワードマーク専用 (= RootLens の文字だけ Fraunces)
  brand: 'Fraunces_700Bold',
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
    letterSpacing: 1.0, textTransform: 'uppercase' as const,
  },
  labelSmall: {
    fontFamily: fonts.sansSemibold, fontSize: 10, lineHeight: 14,
    letterSpacing: 1.1, textTransform: 'uppercase' as const,
  },
  // Mono — readouts, hashes, prices
  mono: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 0.2 },
  monoLg: { fontFamily: fonts.mono, fontSize: 14, letterSpacing: 0.2 },
  // legacy aliases used by older screens
  heading: { fontFamily: fonts.serifMedium, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  small: { fontFamily: fonts.sansSemibold, fontSize: 10, lineHeight: 14, letterSpacing: 1.1 },
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
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 4,
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
