// RootLens ブランドマーク (= 同心円 + 十字ティックのレンズグリフ + ワードマーク)。
// ログイン画面とマイビデオの扉カラムで共用する。

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, fonts } from '../theme';

export const BrandMark: React.FC<{ size?: number; withWordmark?: boolean }> = ({
  size = 22,
  withWordmark = true,
}) => (
  <View style={styles.row}>
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <Circle cx={14} cy={14} r={13} stroke={colors.ink} strokeWidth={1.4} />
      <Circle cx={14} cy={14} r={6.5} stroke={colors.ink} strokeWidth={1.4} />
      <Path
        d="M14 1v6.5M14 20.5V27M1 14h6.5M20.5 14H27"
        stroke={colors.ink}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
    {withWordmark ? <Text style={styles.wordmark}>ROOTLENS</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 2.2,
    color: colors.ink,
  },
});
