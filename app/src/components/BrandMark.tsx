// RootLens ブランドマーク (= アプリ実ロゴの二重 R + Fraunces の太いワードマーク)。
// ログイン画面とマイビデオの扉カラムで共用する。

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';

export const BrandMark: React.FC<{ size?: number; withWordmark?: boolean }> = ({
  size = 30,
  withWordmark = true,
}) => (
  <View style={styles.row}>
    {/* LP のナビと同じ: アイコンは -6° 傾ける */}
    <Image
      source={require('../../assets/icon.png')}
      style={{ width: size, height: size, borderRadius: size * 0.24, transform: [{ rotate: '-6deg' }] }}
      resizeMode="cover"
    />
    {withWordmark ? (
      <Text style={[styles.wordmark, { fontSize: size * 0.6 }]} numberOfLines={1}>
        Root<Text style={styles.wordmarkAccent}>Lens</Text>
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: {
    fontFamily: fonts.sansBold,
    letterSpacing: 0.2,
    color: colors.ink,
    flexShrink: 0,
  },
  // LP のロゴと同じ「Lens」 だけ黄色 (= 差し色は点で使う)
  wordmarkAccent: { color: colors.lpYellow },
});
