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
    <Image
      source={require('../../assets/icon.png')}
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
      resizeMode="cover"
    />
    {withWordmark ? (
      <Text style={[styles.wordmark, { fontSize: size * 0.6 }]} numberOfLines={1}>
        RootLens
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: {
    fontFamily: fonts.brand,
    letterSpacing: -0.3,
    color: colors.ink,
    flexShrink: 0,
  },
});
