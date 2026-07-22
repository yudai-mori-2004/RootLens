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
  accent: '#FFE600',
  accentDeep: '#E8D200',
  accentSoft: '#332D10',
  accentFaint: '#26210D',

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
  borderAccent: '#8F7F1A',

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
// LP と同じ 3 面: Noto Sans JP (本文) + DotGothic16 (読み出し/ラベル) + Anton (英語見出し)。
export const fonts = {
  // 表示 (= 見出し / ヒーロー数値)
  serifLight: 'NotoSansJP_300Light',
  serifRegular: 'NotoSansJP_400Regular',
  serifMedium: 'NotoSansJP_500Medium',
  serifSemibold: 'NotoSansJP_700Bold',
  serifBold: 'NotoSansJP_900Black',

  // 本文 / UI
  sansRegular: 'NotoSansJP_400Regular',
  sansMedium: 'NotoSansJP_500Medium',
  sansSemibold: 'NotoSansJP_700Bold',
  sansBold: 'NotoSansJP_900Black',

  // 読み出し (= hash 類だけ。 人向けの数値は dot を使う)
  mono: 'JetBrainsMono_500Medium',

  // LP のドット文字 (= 数値の読み出し / セクションラベル。 日本語グリフも持つ)
  dot: 'DotGothic16_400Regular',

  // LP の見出し (= Anton。 Latin のみ。 英語ヒーローと見出しの圧に使う)
  display: 'Anton_400Regular',
} as const;

export const typography = {
  // Display
  display1: { fontFamily: fonts.serifLight, fontSize: 44, lineHeight: 50, letterSpacing: -0.6 },
  display2: { fontFamily: fonts.serifRegular, fontSize: 32, lineHeight: 38, letterSpacing: -0.4 },
  display3: { fontFamily: fonts.serifMedium, fontSize: 24, lineHeight: 30, letterSpacing: -0.2 },
  // Title — used for screen headers and card titles
  title: { fontFamily: fonts.serifMedium, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  titleSans: { fontFamily: fonts.sansSemibold, fontSize: 17, lineHeight: 24, letterSpacing: -0.1 },
  // Body (= Noto Sans JP は上下の空きが多いので lineHeight を余裕を持たせる)
  body: { fontFamily: fonts.sansRegular, fontSize: 15, lineHeight: 24 },
  bodyMedium: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 24 },
  // Caption
  caption: { fontFamily: fonts.sansRegular, fontSize: 13, lineHeight: 20 },
  captionMedium: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 20 },
  // Labels (= セクション見出し / チップ。 LP のドット文字ラベルの文法。
  // DotGothic は上下の間延びがあるので lineHeight を fontSize の 1.5 倍以上確保)
  label: {
    fontFamily: fonts.dot, fontSize: 12, lineHeight: 18,
    letterSpacing: 1.0, textTransform: 'uppercase' as const,
  },
  labelSmall: {
    fontFamily: fonts.dot, fontSize: 11, lineHeight: 17,
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

// Hard offset shadow — LP の box-shadow と同じ「ずらして硬く落とす」影。
// ブラー無し + 斜めオフセットで、紙を貼ったステッカーの厚みを出す。
// iPhone 前提なので iOS の shadow を主に見る。Android の elevation はソフトになる。
export const shadows = {
  card: {
    shadowColor: '#080410',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 0,
    elevation: 6,
  },
  // モーダル / ポップオーバー — 一段深くずらす
  pop: {
    shadowColor: '#080410',
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 0,
    elevation: 10,
  },
  // legacy aliases — こちらも硬い影に統一
  sm: {
    shadowColor: '#080410', shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 0, elevation: 3,
  },
  md: {
    shadowColor: '#080410', shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.52, shadowRadius: 0, elevation: 4,
  },
  lg: {
    shadowColor: '#080410', shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.55, shadowRadius: 0, elevation: 6,
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
