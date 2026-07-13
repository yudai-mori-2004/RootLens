// LP (パンフレット) の署名的なパーツ:
//   • Pill — ink 地 + アクセント色文字、 letter-spacing 広めの caps、 -1.5° 傾き
//   • HighlightText — テキストの裏に skewX(-6deg) の色ボックスを敷く
//   • OutlineNumber — アウトラインだけの太い数字 (SVG)
// どれもフライヤーの CSS を React Native に写しただけ。

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';

import { colors, fonts } from '../theme';

/** LP のピル (= 「人手を探しているお店へのご提案」的な帯)。 */
export const Pill: React.FC<{
  label: string;
  accent?: keyof typeof PILL_COLORS;
  style?: ViewStyle;
}> = ({ label, accent = 'lime', style }) => (
  <View style={[styles.pill, style]}>
    <Text style={[styles.pillText, { color: PILL_COLORS[accent] }]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const PILL_COLORS = {
  lime: colors.lpLime,
  yellow: colors.lpYellow,
  pink: colors.lpPink,
  cyan: '#00E5FF',
} as const;

/** テキストの背後に skew した色ボックス。 children は 1 行想定 (Text wrap 前提)。 */
export const HighlightText: React.FC<{
  text: string;
  color?: string;
  textStyle?: React.ComponentProps<typeof Text>['style'];
  boxOffsetY?: number;
}> = ({ text, color = colors.lpYellow, textStyle, boxOffsetY = 4 }) => (
  <View style={styles.hlWrap}>
    <View
      style={[
        styles.hlBox,
        {
          backgroundColor: color,
          top: boxOffsetY,
        },
      ]}
    />
    <Text style={[styles.hlText, textStyle]}>{text}</Text>
  </View>
);

/** SVG で描くアウトラインだけの太い数字 (ステップの 01 / 02 / 03 みたいなやつ)。 */
export const OutlineNumber: React.FC<{ text: string; color: string; fontSize?: number }> = ({
  text, color, fontSize = 32,
}) => (
  <Svg width={fontSize * text.length * 0.66} height={fontSize * 1.05}>
    <SvgText
      x="0"
      y={fontSize * 0.85}
      fontFamily={fonts.display}
      fontSize={fontSize}
      fill="none"
      stroke={color}
      strokeWidth={1.4}
      letterSpacing="1"
    >
      {text}
    </SvgText>
  </Svg>
);

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.textOnInk, // = paper より濃い ink 系
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    transform: [{ rotate: '-1.5deg' }],
  },
  pillText: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  hlWrap: { alignSelf: 'flex-start', position: 'relative', overflow: 'visible' },
  hlBox: {
    position: 'absolute',
    left: -6,
    right: -6,
    height: '75%',
    borderRadius: 2,
    transform: [{ skewX: '-6deg' }],
  },
  hlText: {
    color: colors.ink,
    zIndex: 1,
  },
});
