import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { VlmResult } from '../../02-vlm-task-gate/vlmClient';
import type { TaskDef } from '../tasks';
import { colors, fonts, hairline, radius, space, type } from '../theme';

interface Props {
  task: TaskDef;
  videoUri: string | null;
  endSnapshotUri: string | null;
  durationMs: number;
  vlmEnd: VlmResult | null;
  vlmEndError: string | null;
  canMint: boolean;
  onMint: () => void;
  onRedo: () => void;
  onBackToList: () => void;
}

export const ResultView: React.FC<Props> = ({
  task, endSnapshotUri, durationMs, vlmEnd, vlmEndError, canMint, onMint, onRedo, onBackToList,
}) => {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const duration = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const score = vlmEnd?.score ?? null;
  const band = bandFor(score);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero: snapshot + task name */}
        {endSnapshotUri ? (
          <Image source={{ uri: endSnapshotUri }} style={styles.snapshot} resizeMode="cover" />
        ) : (
          <View style={[styles.snapshot, styles.snapshotMissing]}>
            <Text style={styles.snapshotMissingText}>no snapshot</Text>
          </View>
        )}

        <View style={styles.head}>
          <Text style={styles.eyebrow}>TASK COMPLETE</Text>
          <Text style={styles.taskName}>{task.name}</Text>
        </View>

        {/* Score */}
        {score !== null ? (
          <View style={styles.scoreBox}>
            <Text style={styles.scoreLabel}>End condition score</Text>
            <View style={styles.scoreRow}>
              <Text style={[styles.scoreValue, { color: band.color }]}>{score}</Text>
              <View style={styles.scoreSlash}>
                <Text style={styles.scoreSlashText}>/ 100</Text>
                <Text style={[styles.scoreBand, { color: band.color }]}>{band.label}</Text>
              </View>
            </View>
            {vlmEnd?.reason ? <Text style={styles.reason}>{vlmEnd.reason}</Text> : null}
          </View>
        ) : null}

        {vlmEndError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorLabel}>SCORE UNAVAILABLE</Text>
            <Text style={styles.errorText}>{vlmEndError}</Text>
          </View>
        ) : null}

        {/* Duration */}
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Duration</Text>
            <Text style={styles.metaValue}>{duration}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bar}>
        <Pressable style={styles.backLink} onPress={onBackToList} hitSlop={12}>
          <Text style={styles.backLinkText}>← Tasks</Text>
        </Pressable>
        <View style={styles.barActions}>
          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            onPress={onRedo}
          >
            <Text style={styles.secondaryLabel}>Record again</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.cta, !canMint && styles.ctaDisabled, pressed && canMint && styles.ctaPressed]}
            onPress={onMint}
            disabled={!canMint}
          >
            <Text style={[styles.ctaLabel, !canMint && styles.ctaLabelDisabled]}>
              Mint Core NFT →
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

function bandFor(score: number | null): { label: string; color: string } {
  if (score === null) return { label: '—', color: colors.textFaint };
  if (score >= 90) return { label: 'EXCELLENT', color: colors.statusOk };
  if (score >= 70) return { label: 'GOOD',      color: colors.statusOk };
  if (score >= 40) return { label: 'PARTIAL',   color: colors.statusWarn };
  return                    { label: 'MISSED',    color: colors.statusError };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgWarm },
  scroll: { paddingBottom: space.xxxxl },

  snapshot: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000',
  },
  snapshotMissing: { alignItems: 'center', justifyContent: 'center' },
  snapshotMissingText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.textFaint,
  },

  head: {
    paddingHorizontal: space.xl,
    paddingTop: space.l,
    paddingBottom: space.m,
    gap: space.xs,
  },
  eyebrow: { ...type.caps, color: colors.textMute },
  taskName: { ...type.display1, color: colors.textInk },

  scoreBox: {
    paddingHorizontal: space.xl,
    paddingTop: space.l,
    paddingBottom: space.xl,
    gap: space.s,
    ...hairline('top'),
  },
  scoreLabel: { ...type.caps, color: colors.textMute },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.m,
    marginTop: space.xs,
  },
  scoreValue: {
    fontFamily: fonts.displayLight,
    fontSize: 88,
    lineHeight: 92,
    letterSpacing: -2,
  },
  scoreSlash: { gap: 2 },
  scoreSlashText: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.textFaint,
    letterSpacing: 0.5,
  },
  scoreBand: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: '700',
    marginTop: 2,
  },
  reason: {
    ...type.bodyL,
    color: colors.textBody,
    marginTop: space.s,
  },

  errorBox: {
    marginHorizontal: space.xl,
    marginTop: space.l,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    backgroundColor: colors.statusErrorSoft,
    borderLeftWidth: 2,
    borderLeftColor: colors.statusError,
    borderRadius: radius.s,
    gap: 4,
  },
  errorLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.statusError,
    fontWeight: '600',
  },
  errorText: { ...type.bodyS, color: colors.textBody },

  metaRow: {
    flexDirection: 'row',
    paddingHorizontal: space.xl,
    paddingTop: space.l,
    gap: space.xl,
  },
  metaItem: { gap: 2 },
  metaLabel: { ...type.caps, color: colors.textMute },
  metaValue: {
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.textInk,
    letterSpacing: 0.4,
    marginTop: 2,
  },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.m,
    paddingBottom: space.xl,
    backgroundColor: colors.bgWhite,
    ...hairline('top'),
    gap: space.m,
  },
  backLink: { paddingVertical: space.s },
  backLinkText: { ...type.body, color: colors.textInk, fontWeight: '500' },
  barActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  secondary: {
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgWhite,
  },
  secondaryPressed: { backgroundColor: colors.bgWarm },
  secondaryLabel: {
    color: colors.textInk,
    fontFamily: fonts.displayMedium,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  cta: {
    backgroundColor: colors.bgInk,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: radius.s,
  },
  ctaPressed: { backgroundColor: colors.bgInkSoft },
  ctaDisabled: { backgroundColor: colors.border },
  ctaLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  ctaLabelDisabled: { color: colors.textFaint },
});
