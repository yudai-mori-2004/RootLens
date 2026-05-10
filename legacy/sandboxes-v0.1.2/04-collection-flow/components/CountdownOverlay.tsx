import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COUNTDOWN_MS } from '../stateMachine';
import { colors, fonts, type } from '../theme';

// Center overlay during 3 → 2 → 1 countdown.
// Refined serif numerals (Fraunces light) on a soft scrim.
// Independent rAF-based clock so the rendering ticks every frame regardless of state-machine cadence.

interface Props {
  startTs: number;
}

export const CountdownOverlay: React.FC<Props> = ({ startTs }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      setNow(Date.now());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const remainingMs = Math.max(0, COUNTDOWN_MS - (now - startTs));
  const n = Math.ceil(remainingMs / 1000); // 3 → 2 → 1 → 0
  if (n <= 0) return null;

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>STARTING IN</Text>
        <Text style={styles.number}>{n}</Text>
        <Text style={styles.hint}>Keep both palms open</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 31, 68, 0.42)',
  },
  card: {
    paddingHorizontal: 56,
    paddingVertical: 36,
    backgroundColor: colors.bgScrim,
    borderRadius: 4,
    alignItems: 'center',
    gap: 4,
  },
  eyebrow: {
    ...type.caps,
    color: colors.textMute,
  },
  number: {
    fontFamily: fonts.displayLight,
    fontSize: 144,
    lineHeight: 156,
    color: colors.textInk,
    letterSpacing: -2,
  },
  hint: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.3,
    color: colors.textMute,
    textTransform: 'uppercase',
  },
});
