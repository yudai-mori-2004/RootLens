import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COUNTDOWN_MS } from '../domain/captureFlow';
import { colors, typography, spacing } from '../theme';

// Center overlay during 3 → 2 → 1 countdown.
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
    backgroundColor: colors.overlayMedium,
  },
  card: {
    paddingHorizontal: 56,
    paddingVertical: 36,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    alignItems: 'center',
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.label,
    color: colors.textSecondary,
    letterSpacing: 1.6,
  },
  number: {
    fontSize: 120,
    lineHeight: 132,
    fontWeight: '300',
    color: colors.textPrimary,
    letterSpacing: -2,
  },
  hint: {
    ...typography.small,
    letterSpacing: 1.3,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
});
