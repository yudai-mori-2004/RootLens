import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

// Hand-status indicator (top-right of capture screen during recording).
// Minimal SVG glyph + caps label. Navy ink on white when ok, rust when no hands.

interface Props {
  handsOk: boolean;
}

export const HandStatusBadge: React.FC<Props> = ({ handsOk }) => (
  <View style={[styles.badge, handsOk ? styles.ok : styles.ng]}>
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      {handsOk ? (
        // open palm (5-finger silhouette, simplified)
        <Path
          d="M7 3v8M11 2.5v9M15 3v8M19 5v6.5M5 9c0 5 3 9 7 9s7-4 7-9"
          stroke={colors.white}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ) : (
        // X (no hands detected)
        <Path
          d="M5 5l14 14M19 5L5 19"
          stroke={colors.white}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      )}
    </Svg>
    <Text style={styles.label}>{handsOk ? 'OK' : 'NO HANDS'}</Text>
  </View>
);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  ok: {
    backgroundColor: colors.accent,
  },
  ng: {
    backgroundColor: colors.error,
  },
  label: {
    color: colors.white,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '600',
  },
});
