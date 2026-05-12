import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import Svg, { Circle, Path } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { findTask } from '../domain/taskCatalog';
import { processPrivacyBlur, isPrivacyBlurAvailable } from '../units/privacy-blur';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// 撮影直後のレビュー画面。
// First-time user 視点に揃えて jargon (TEE / Title Protocol / R2) は出さない。
// 何が起きているかではなく、「あなたにとって何を意味するか」を見せる。

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;

type BlurState =
  | { kind: 'pending' }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; outputUri: string; durationMs: number; faceCount: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; message: string };

const PRIVACY_ART = require('../../assets/decor/privacy-shield.png');

export const ReviewScreen: React.FC<Props> = ({ route, navigation }) => {
  const { taskId, videoUri, vlmEnd, vlmEndError, durationMs } = route.params;
  const task = findTask(taskId);
  const [blur, setBlur] = useState<BlurState>({ kind: 'pending' });

  useEffect(() => {
    if (!isPrivacyBlurAvailable()) {
      setBlur({ kind: 'skipped', reason: `Privacy blur unavailable on ${Platform.OS}` });
      return;
    }
    let cancelled = false;
    setBlur({ kind: 'running', progress: 0 });
    (async () => {
      const t0 = Date.now();
      try {
        const result = await processPrivacyBlur(
          { inputUri: videoUri },
          (p) => { if (!cancelled) setBlur({ kind: 'running', progress: p.progress ?? 0 }); },
        );
        if (cancelled) return;
        setBlur({
          kind: 'done',
          outputUri: result.outputUri,
          durationMs: result.durationMs ?? Date.now() - t0,
          faceCount: result.facesBlurred ?? 0,
        });
      } catch (err: any) {
        if (cancelled) return;
        setBlur({ kind: 'error', message: err?.message ?? String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [videoUri]);

  const playbackUri =
    blur.kind === 'done' ? blur.outputUri :
    blur.kind === 'skipped' ? videoUri :
    null;

  const canProceed = blur.kind === 'done' || blur.kind === 'skipped';
  const proceed = () => {
    const out = blur.kind === 'done' ? blur.outputUri : videoUri;
    navigation.replace('SignAndMint', {
      taskId,
      processedVideoUri: out,
      originalVideoUri: videoUri,
    });
  };

  const score = vlmEnd?.score ?? null;
  const verdict = scoreToVerdict(score);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* HERO — friendly headline based on score */}
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{task?.name ?? 'Recorded'}</Text>
          <Text style={styles.heroTitle}>{verdict.title}</Text>
          <Text style={styles.heroLede}>{verdict.lede}</Text>
        </View>

        {/* Score meter (only if scored) */}
        {score !== null && (
          <View style={styles.scoreCard}>
            <View style={styles.scoreCardTop}>
              <Text style={styles.scoreLabel}>How well it matched the goal</Text>
              <Text style={[styles.scoreNumber, { color: verdict.color }]}>{score}</Text>
            </View>
            <ScoreMeter value={score} color={verdict.color} />
            {vlmEnd?.reason && (
              <Text style={styles.scoreReason}>{vlmEnd.reason}</Text>
            )}
          </View>
        )}
        {vlmEndError && (
          <View style={styles.warnCard}>
            <Text style={styles.warnLabel}>Couldn't score this take</Text>
            <Text style={styles.warnBody}>{vlmEndError}</Text>
          </View>
        )}

        {/* Video preview */}
        <View style={styles.videoCard}>
          {playbackUri ? (
            <Video
              source={{ uri: playbackUri }}
              style={styles.video}
              useNativeControls
              isLooping
              resizeMode={ResizeMode.CONTAIN}
            />
          ) : (
            <View style={[styles.video, styles.videoPlaceholder]}>
              <ActivityIndicator color={colors.card} />
              <Text style={styles.videoPlaceholderText}>
                {blur.kind === 'running'
                  ? `Cleaning it up · ${Math.round((blur.progress ?? 0) * 100)}%`
                  : 'Preparing preview…'}
              </Text>
            </View>
          )}
        </View>

        {/* Privacy reassurance */}
        <View style={styles.privacyCard}>
          <Image source={PRIVACY_ART} style={styles.privacyArt} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.privacyTitle}>{privacyTitle(blur)}</Text>
            <Text style={styles.privacyBody}>{privacyBody(blur)}</Text>
          </View>
        </View>

        {/* Tip — what tap does */}
        <Text style={styles.bottomHint}>
          Tap continue to make this clip yours, on-chain.
        </Text>
      </ScrollView>

      {/* Bottom action bar */}
      <View style={styles.bar}>
        <Pressable
          onPress={() => navigation.replace('Capture', { taskId })}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryLabel}>Redo</Text>
        </Pressable>
        <Pressable
          onPress={proceed}
          disabled={!canProceed}
          style={({ pressed }) => [
            styles.cta,
            !canProceed && styles.ctaDisabled,
            pressed && canProceed && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaLabel, !canProceed && styles.ctaLabelDisabled]}>
            Looks good — continue →
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

// ---- helpers ----------------------------------------------------------

function scoreToVerdict(score: number | null): {
  title: string; lede: string; color: string;
} {
  if (score === null) {
    return {
      title: 'Take a look',
      lede: 'Watch it back. If it looks right, continue.',
      color: colors.textBody,
    };
  }
  if (score >= 90) return {
    title: 'Picture-perfect.',
    lede: 'Every part of the goal is clearly visible. Great take.',
    color: colors.emeraldDeep,
  };
  if (score >= 70) return {
    title: 'Nice take.',
    lede: 'The goal is satisfied. Continue if you’re happy with the framing.',
    color: colors.emeraldDeep,
  };
  if (score >= 40) return {
    title: 'Partial.',
    lede: 'Some parts of the goal aren’t fully shown. You can still continue, but a redo may earn more.',
    color: colors.warn,
  };
  return {
    title: "Didn't quite catch it.",
    lede: 'The goal isn’t clearly satisfied in this clip. A redo will likely score better.',
    color: colors.danger,
  };
}

function privacyTitle(b: BlurState): string {
  switch (b.kind) {
    case 'pending':
    case 'running':
      return 'Cleaning up faces in your clip…';
    case 'done':
      return b.faceCount > 0 ? 'Faces blurred. Your privacy stays yours.' : 'No faces detected — nothing to blur.';
    case 'skipped':
      return 'Privacy step skipped on this device.';
    case 'error':
      return "Couldn't blur faces.";
  }
}

function privacyBody(b: BlurState): string {
  switch (b.kind) {
    case 'pending': return 'Just a few seconds.';
    case 'running': return `Working… ${Math.round((b.progress ?? 0) * 100)}%`;
    case 'done':
      return b.faceCount > 0
        ? `${b.faceCount} face track(s) softened automatically — done in ${(b.durationMs / 1000).toFixed(1)}s. The original never leaves your phone.`
        : 'Continuing with the original frames.';
    case 'skipped': return 'Sending the original frames as-is.';
    case 'error': return b.message;
  }
}

const ScoreMeter: React.FC<{ value: number; color: string }> = ({ value, color }) => (
  <View style={styles.meter}>
    <View style={[styles.meterFill, { width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }]} />
  </View>
);

// ---- styles -----------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },

  hero: { paddingTop: spacing.sm, gap: 4 },
  eyebrow: { ...typography.label, color: colors.textMute },
  heroTitle: {
    fontFamily: fonts.serifSemibold,
    fontSize: 32,
    color: colors.ink,
    letterSpacing: -0.5,
    lineHeight: 38,
    marginTop: 4,
  },
  heroLede: {
    ...typography.body,
    color: colors.textBody,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },

  // score card
  scoreCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  scoreCardTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  scoreLabel: {
    ...typography.caption,
    color: colors.textBody,
    flex: 1,
    fontSize: 13,
  },
  scoreNumber: {
    fontFamily: fonts.serifMedium,
    fontSize: 36,
    letterSpacing: -0.6,
  },
  meter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.paperDeep,
    overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: 4 },
  scoreReason: {
    ...typography.caption,
    color: colors.textBody,
    marginTop: 4,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 19,
  },

  warnCard: {
    backgroundColor: colors.warnSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
    borderLeftWidth: 2,
    borderLeftColor: colors.warn,
  },
  warnLabel: { ...typography.labelSmall, color: colors.warn },
  warnBody: { ...typography.caption, color: colors.textBody },

  // video
  videoCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  video: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  videoPlaceholderText: { color: colors.card, ...typography.caption },

  // privacy
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.card,
  },
  privacyArt: { width: 64, height: 64 },
  privacyTitle: {
    fontFamily: fonts.serifMedium,
    fontSize: 15,
    color: colors.ink,
    lineHeight: 21,
  },
  privacyBody: {
    ...typography.caption,
    color: colors.textBody,
    marginTop: 2,
    lineHeight: 18,
    fontSize: 12.5,
  },

  bottomHint: {
    ...typography.caption,
    color: colors.textMute,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  // bottom bar
  bar: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  secondary: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryPressed: { backgroundColor: colors.paperDeep },
  secondaryLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.ink,
  },
  cta: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaPressed: { backgroundColor: colors.inkSoft },
  ctaDisabled: { backgroundColor: colors.paperDeep },
  ctaLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    letterSpacing: 0.1,
  },
  ctaLabelDisabled: { color: colors.textFaint },
});
