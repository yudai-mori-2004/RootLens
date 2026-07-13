// RootLens design system — LP (rootlens.io) の neon zine をアプリに移植した暗室。
//
// ベースは LP と同じ紫黒。 差し色は LP の文法をそのまま使う:
//   黄 = マーク / 強調 (ワードマークの Lens と同系)
//   ピンク = 行動 (録画・アップロード・サインイン)
//   ライム = 進捗・蓄積 (アップロード進捗、 日別グラフ)
// 日本語は M PLUS 1、 数値の読み出しは DotGothic (= LP のドット文字)、 hash 類は JetBrains Mono。
// 主役は映像、 UI は黒子 — 面はあくまで紫黒、 色は点で置く。

import { Platform } from 'react-native';

// ── Palette ──────────────────────────────────────────────────────────────
export const colors = {
  // Surfaces (= LP の #170529 系を端末向けにわずかに沈めた紫黒)
  paper: '#150B24',          // dominant violet-black
  paperDeep: '#1D1132',      // inset surface
  card: '#211539',           // raised surface
  ink: '#F4F1FA',            // primary light text (= violet-tinted white)
  inkSoft: '#FFFFFF',
  inkMute: '#B9B3CC',
  scrim: 'rgba(10, 4, 20, 0.6)',

  // Text
  textInk: '#F4F1FA',
  textBody: '#C9C3DC',
  textMute: '#8D86A6',
  textFaint: '#5C5478',
  textOnInk: '#150B24',

  // Accent — 黄 (= LP のマーク色。 確定・強調・選択)
  emerald: '#FFE600',
  emeraldDeep: '#E8D200',
  emeraldSoft: '#332D10',
  emeraldFaint: '#26210D',

  // Highlight
  gold: '#FFE600',
  goldSoft: '#332D10',

  // Accent — LP の残り 2 色 (ピンク = 行動 / ライム = 進捗)
  lpPink: '#FF2E93',
  lpLime: '#C8FF00',
  lpYellow: '#FFE600',

  // Borders / hairlines
  border: '#2E2249',
  borderInk: '#F4F1FA',
  borderEmerald: '#8F7F1A',

  // Status
  success: '#A5E22B',
  successSoft: '#26320D',
  warn: '#D99A3D',
  warnSoft: '#2F2718',
  danger: '#E05548',
  dangerSoft: '#33201D',
  recording: '#E05548',

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

  // LP の見出し (= Anton。 Latin のみ。 英語ヒーローと見出しの圧に使う)
  display: 'Anton_400Regular',

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
