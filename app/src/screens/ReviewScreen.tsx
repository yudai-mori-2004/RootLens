import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { findTask } from '../domain/taskCatalog';
import { processPrivacyBlur, isPrivacyBlurAvailable } from '../units/privacy-blur';
import { colors, typography, spacing, radii } from '../theme';

// SPECS_JA §2.3 step 7: 撮影直後に on-device で顔 blur → ユーザに確認させる。
// Unit C は iOS 限定。Android では blur skip して raw video で進む。
// Approve → SignAndMint。Redo → Capture (replace で戻る)。

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;

type BlurState =
  | { kind: 'pending' }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; outputUri: string; durationMs: number; faceCount: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; message: string };

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

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Score recap */}
        <View style={styles.section}>
          <Text style={styles.eyebrow}>TASK</Text>
          <Text style={styles.title}>{task?.name ?? taskId}</Text>
          <Text style={styles.meta}>
            Duration {Math.round(durationMs / 100) / 10}s
            {vlmEnd ? `  ·  Score ${vlmEnd.score}/100  ·  ${vlmEnd.match ? 'MATCH' : 'NO MATCH'}` : ''}
          </Text>
          {vlmEnd?.reason ? <Text style={styles.body}>{vlmEnd.reason}</Text> : null}
          {vlmEndError ? <Text style={styles.errorText}>VLM error: {vlmEndError}</Text> : null}
        </View>

        {/* Video preview */}
        <View style={styles.videoWrap}>
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
              <ActivityIndicator color={colors.white} />
              <Text style={styles.videoPlaceholderText}>
                {blur.kind === 'running' ? `Privacy blur ${Math.round((blur.progress ?? 0) * 100)}%` : 'Preparing…'}
              </Text>
            </View>
          )}
        </View>

        {/* Privacy-blur status */}
        <View style={styles.section}>
          <Text style={styles.eyebrow}>PRIVACY BLUR</Text>
          {blur.kind === 'pending' && <Text style={styles.body}>Starting…</Text>}
          {blur.kind === 'running' && (
            <Text style={styles.body}>
              In progress — {Math.round((blur.progress ?? 0) * 100)}%
            </Text>
          )}
          {blur.kind === 'done' && (
            <Text style={styles.body}>
              Done in {(blur.durationMs / 1000).toFixed(1)}s · {blur.faceCount} face track(s) blurred.
            </Text>
          )}
          {blur.kind === 'skipped' && (
            <Text style={styles.body}>Skipped — {blur.reason}. Sending raw clip to TP.</Text>
          )}
          {blur.kind === 'error' && (
            <Text style={styles.errorText}>Failed: {blur.message}</Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          onPress={() => navigation.replace('Capture', { taskId })}
        >
          <Text style={styles.secondaryLabel}>Redo</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.cta,
            !canProceed && styles.ctaDisabled,
            pressed && canProceed && styles.ctaPressed,
          ]}
          onPress={proceed}
          disabled={!canProceed}
        >
          <Text style={styles.ctaLabel}>Approve & continue →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: spacing.xl },

  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs },
  eyebrow: { ...typography.label, color: colors.textSecondary, letterSpacing: 1.6 },
  title: { ...typography.heading, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, fontFamily: 'Menlo' },
  body: { ...typography.body, color: colors.textPrimary },
  errorText: { ...typography.body, color: colors.error },

  videoWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  video: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000', borderRadius: radii.md },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  videoPlaceholderText: { color: colors.darkText, ...typography.caption },

  footer: {
    flexDirection: 'row', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.background,
  },
  secondary: {
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    alignItems: 'center',
  },
  secondaryPressed: { backgroundColor: colors.surface },
  secondaryLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  cta: {
    flex: 1,
    paddingVertical: spacing.md, borderRadius: radii.md,
    backgroundColor: colors.accent, alignItems: 'center',
  },
  ctaPressed: { backgroundColor: colors.accentDark },
  ctaDisabled: { backgroundColor: colors.textDisabled },
  ctaLabel: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
