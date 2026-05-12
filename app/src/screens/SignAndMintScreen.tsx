import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import Svg, { Path } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { findTask } from '../domain/taskCatalog';
import { getDemoWalletPubkey } from '../domain/wallet';
import { signContent } from '../native/c2paBridge';
import { registerOnTitleProtocol } from '../services/titleProtocol';
import { config } from '../config';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// 「あなたの動画が、あなたの資産になる」フェーズ。
// First-time user 視点で書く。技術用語 (TEE / TP / R2 / asset_id) は出さない。
// 内部で 3 つの step を順に await する点は変わらず。

type Props = NativeStackScreenProps<RootStackParamList, 'SignAndMint'>;

type StepState =
  | { kind: 'pending' }
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

interface FriendlyStep {
  illust: any;
  headline: string;
  body: string;
}

const STEPS: FriendlyStep[] = [
  {
    illust: require('../../assets/decor/step-seal.png'),
    headline: 'Sealing it',
    body: 'Your phone signs the clip with a tamper-proof seal. Future buyers can verify it’s the real thing.',
  },
  {
    illust: require('../../assets/decor/step-register.png'),
    headline: 'Registering it as yours',
    body: 'Recording it on Solana as your property. From this moment, the clip is on-chain — only you can move it.',
  },
  {
    illust: require('../../assets/decor/step-storage.png'),
    headline: 'Putting it where buyers find it',
    body: 'Storing the file in shared storage so AI labs can request a license later.',
  },
];

const HERO_DECOR = require('../../assets/decor/celebration.png');

export const SignAndMintScreen: React.FC<Props> = ({ route, navigation }) => {
  const { taskId, processedVideoUri } = route.params;
  const task = findTask(taskId);
  const ownerPubkey = useMemo(() => getDemoWalletPubkey(), []);

  const [c2paStep, setC2paStep] = useState<StepState>({ kind: 'pending' });
  const [tpStep, setTpStep] = useState<StepState>({ kind: 'pending' });
  const [r2Step, setR2Step] = useState<StepState>({ kind: 'pending' });

  const [contentHash, setContentHash] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!ownerPubkey || !task) return;
    let cancelled = false;
    (async () => {
      // Step 1: C2PA sign
      let signedPath = processedVideoUri;
      if (Platform.OS === 'ios') {
        setC2paStep({ kind: 'running' });
        try {
          const out = await signContent(processedVideoUri.replace(/^file:\/\//, ''), [
            { label: 'rootlens.task', data: { task_id: taskId, task_name: task.name } },
          ]);
          if (cancelled) return;
          signedPath = out.startsWith('file://') ? out : `file://${out}`;
          setC2paStep({ kind: 'done' });
        } catch (err: any) {
          if (cancelled) return;
          setC2paStep({ kind: 'error', message: err?.message ?? String(err) });
          return;
        }
      } else {
        setC2paStep({ kind: 'done' });
      }

      // Step 2: TP register
      setTpStep({ kind: 'running' });
      let hash = '';
      let tx = '';
      try {
        const cleanPath = signedPath.replace(/^file:\/\//, '');
        const r = await registerOnTitleProtocol(cleanPath, ownerPubkey.toBase58(), 'RootLens', 'video');
        if (cancelled) return;
        hash = r.contentHash.replace(/^0x/i, '').toLowerCase();
        tx = r.txSignature;
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          throw new Error(`malformed content_hash: "${r.contentHash}"`);
        }
        setContentHash(hash);
        setMintTx(tx);
        setTpStep({ kind: 'done' });
      } catch (err: any) {
        if (cancelled) return;
        setTpStep({ kind: 'error', message: err?.message ?? String(err) });
        return;
      }

      // Step 3: R2 upload
      setR2Step({ kind: 'running' });
      try {
        const sizeInfo = await FileSystem.getInfoAsync(signedPath);
        if (!sizeInfo.exists) throw new Error('signed file missing on disk');
        const presignRes = await fetch(config.uploadUrlEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_hash: hash, kind: 'media', contentType: 'video/mp4' }),
        });
        if (!presignRes.ok) {
          const errBody = await presignRes.text();
          throw new Error(`upload-url ${presignRes.status}: ${errBody}`);
        }
        const presign = (await presignRes.json()) as {
          status: 'new' | 'exists';
          uploadUrl?: string;
          publicUrl: string;
        };
        if (presign.status === 'new' && presign.uploadUrl) {
          await FileSystem.uploadAsync(presign.uploadUrl, signedPath, {
            httpMethod: 'PUT',
            headers: { 'Content-Type': 'video/mp4' },
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          });
        }
        if (cancelled) return;
        setPublicUrl(presign.publicUrl);
        setR2Step({ kind: 'done' });
      } catch (err: any) {
        if (cancelled) return;
        setR2Step({ kind: 'error', message: err?.message ?? String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [runId, processedVideoUri, taskId, task, ownerPubkey]);

  const stepStates: StepState[] = [c2paStep, tpStep, r2Step];
  const allDone = stepStates.every((s) => s.kind === 'done');
  const anyError = stepStates.some((s) => s.kind === 'error');
  const errorMsg = stepStates.find((s) => s.kind === 'error');
  const errorText = errorMsg && errorMsg.kind === 'error' ? errorMsg.message : null;

  // Friendly headline by overall state
  const heroTitle = allDone
    ? 'It’s yours, on-chain.'
    : anyError
    ? 'Hit a snag.'
    : 'Turning it into your asset…';
  const heroSub = allDone
    ? 'The clip is now your property. Nobody — not even RootLens — can move it without you.'
    : anyError
    ? 'We can try again. None of your steps so far need to be repeated by hand.'
    : 'Three short steps. Hang tight — usually a few seconds.';

  const goStake = () => {
    if (!contentHash || !mintTx) return;
    navigation.replace('Stake', {
      taskId, rootNftAssetId: '',
      mintTxSignature: mintTx, contentHash, publicUrl,
    });
  };
  const skipStake = () => {
    if (!contentHash) return;
    navigation.replace('Done', {
      taskId, rootNftAssetId: '', contentHash, staked: false, stakeTxSignature: null,
    });
  };
  const retry = () => {
    setC2paStep({ kind: 'pending' });
    setTpStep({ kind: 'pending' });
    setR2Step({ kind: 'pending' });
    setContentHash(null); setMintTx(null); setPublicUrl(null);
    setRunId((n) => n + 1);
  };

  if (!ownerPubkey) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.errorBanner}>No wallet — set EXPO_PUBLIC_DEMO_WALLET_ADDRESS.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* HERO */}
        <View style={[styles.hero, allDone && styles.heroDone]}>
          <View style={styles.heroLeft}>
            <Text style={styles.eyebrow}>{allDone ? 'DONE' : 'IN PROGRESS'}</Text>
            <Text style={styles.heroTitle}>{heroTitle}</Text>
            <Text style={styles.heroSub}>{heroSub}</Text>
          </View>
          {allDone && (
            <Image source={HERO_DECOR} style={styles.heroDecor} resizeMode="contain" />
          )}
        </View>

        {/* STEPS */}
        <View style={styles.stepStack}>
          {STEPS.map((s, i) => (
            <FriendlyStepCard key={i} def={s} state={stepStates[i]} index={i} />
          ))}
        </View>

        {/* On error: a friendly retry button + raw error in collapsed disclosure */}
        {anyError && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Something didn’t go through.</Text>
            <Text style={styles.errorBody}>
              The on-chain or upload step couldn’t complete. We can try again — your clip and signature are still safe on this phone.
            </Text>
            {errorText && (
              <Pressable
                onPress={() => setShowDetails((v) => !v)}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={styles.errorDetailsToggle}>
                  {showDetails ? 'Hide technical details' : 'Show technical details'}
                </Text>
              </Pressable>
            )}
            {showDetails && errorText && (
              <Text style={styles.errorDetailsText} numberOfLines={6}>
                {errorText}
              </Text>
            )}
            <Pressable
              onPress={retry}
              style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            >
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        )}

        {/* On all-done: a "View on Solana" disclosure + technical receipt for the curious */}
        {allDone && (
          <View style={styles.detailsBlock}>
            <Pressable
              onPress={() => setShowDetails((v) => !v)}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.detailsToggle}>
                {showDetails ? 'Hide on-chain details' : 'On-chain details'}
              </Text>
            </Pressable>
            {showDetails && (
              <View style={styles.detailsRows}>
                {contentHash && <DetailRow label="HASH" value={contentHash} />}
                {mintTx && (
                  <DetailRow
                    label="MINT TX"
                    value={mintTx}
                    link={`https://solscan.io/tx/${mintTx}?cluster=devnet`}
                  />
                )}
                {publicUrl && <DetailRow label="PUBLIC URL" value={publicUrl} link={publicUrl} />}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* BOTTOM ACTION BAR */}
      <View style={styles.bar}>
        <Pressable
          onPress={skipStake}
          disabled={!allDone}
          style={({ pressed }) => [
            styles.secondary,
            !allDone && styles.secondaryDisabled,
            pressed && allDone && styles.secondaryPressed,
          ]}
        >
          <Text style={[styles.secondaryLabel, !allDone && { color: colors.textFaint }]}>
            Later
          </Text>
        </Pressable>
        <Pressable
          onPress={goStake}
          disabled={!allDone}
          style={({ pressed }) => [
            styles.cta,
            !allDone && styles.ctaDisabled,
            pressed && allDone && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaLabel, !allDone && styles.ctaLabelDisabled]}>
            Set it up to earn →
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

// ---- step card ---------------------------------------------------------

const FriendlyStepCard: React.FC<{ def: FriendlyStep; state: StepState; index: number }> = ({
  def, state, index,
}) => {
  const isDone = state.kind === 'done';
  const isRunning = state.kind === 'running';
  const isError = state.kind === 'error';
  const isPending = state.kind === 'pending';

  return (
    <View
      style={[
        styles.stepCard,
        isDone && styles.stepCardDone,
        isError && styles.stepCardError,
        isPending && styles.stepCardPending,
      ]}
    >
      {/* status indicator strip on the left */}
      <View style={styles.stepIllustrationCol}>
        <Image source={def.illust} style={[styles.stepIllust, isPending && { opacity: 0.35 }]} resizeMode="contain" />
      </View>
      <View style={styles.stepBody}>
        <View style={styles.stepHeader}>
          <Text style={[styles.stepHeadline, isPending && { color: colors.textFaint }]}>
            {def.headline}
          </Text>
          <StatusGlyph state={state} />
        </View>
        <Text style={[styles.stepDesc, isPending && { color: colors.textFaint }]}>
          {def.body}
        </Text>
      </View>
    </View>
  );
};

const StatusGlyph: React.FC<{ state: StepState }> = ({ state }) => {
  if (state.kind === 'running') {
    return <ActivityIndicator size="small" color={colors.ink} />;
  }
  if (state.kind === 'done') {
    return (
      <View style={styles.statusDoneCircle}>
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={colors.card} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.statusErrorCircle}>
        <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <Path d="M6 6l12 12M18 6L6 18" stroke={colors.card} strokeWidth={2.4} strokeLinecap="round" />
        </Svg>
      </View>
    );
  }
  return <View style={styles.statusPendingCircle} />;
};

const DetailRow: React.FC<{ label: string; value: string; link?: string }> = ({ label, value, link }) => {
  const inner = (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, link && styles.detailValueLink]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
  if (link) {
    return (
      <Pressable
        onPress={() => Linking.openURL(link).catch(() => {})}
        style={({ pressed }) => pressed && { opacity: 0.6 }}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
};

// ---- styles ------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  errorBanner: { ...typography.body, color: colors.danger, textAlign: 'center' },

  // hero
  hero: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
    ...shadows.card,
  },
  heroDone: {
    borderWidth: 2,
    borderColor: colors.borderEmerald,
  },
  heroLeft: { flex: 1, justifyContent: 'center', gap: spacing.xs },
  eyebrow: { ...typography.label, color: colors.textMute },
  heroTitle: {
    fontFamily: fonts.serifSemibold,
    fontSize: 26,
    color: colors.ink,
    letterSpacing: -0.4,
    lineHeight: 32,
    marginTop: 2,
  },
  heroSub: {
    ...typography.body,
    color: colors.textBody,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  heroDecor: { width: 80, height: 80 },

  // step stack
  stepStack: { gap: spacing.md },

  // step card
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  stepCardDone: {
    borderColor: colors.borderEmerald,
    backgroundColor: colors.card,
  },
  stepCardError: {
    borderColor: colors.danger,
  },
  stepCardPending: {
    backgroundColor: colors.paperDeep,
  },
  stepIllustrationCol: {
    width: 64, height: 64,
    alignItems: 'center', justifyContent: 'center',
  },
  stepIllust: { width: 64, height: 64 },
  stepBody: { flex: 1, gap: 2 },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stepHeadline: {
    fontFamily: fonts.serifMedium,
    fontSize: 17,
    color: colors.ink,
    letterSpacing: -0.1,
    flex: 1,
  },
  stepDesc: {
    ...typography.caption,
    color: colors.textBody,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 2,
  },

  // status glyphs
  statusDoneCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.emerald,
    alignItems: 'center', justifyContent: 'center',
  },
  statusErrorCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  statusPendingCircle: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },

  // error card
  errorCard: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorTitle: {
    fontFamily: fonts.serifMedium,
    fontSize: 17,
    color: colors.danger,
  },
  errorBody: {
    ...typography.body,
    color: colors.textBody,
    fontSize: 13.5,
    lineHeight: 19,
  },
  errorDetailsToggle: {
    ...typography.labelSmall,
    color: colors.danger,
    textDecorationLine: 'underline',
    marginTop: 4,
  },
  errorDetailsText: {
    ...typography.mono,
    fontSize: 11,
    color: colors.textBody,
    backgroundColor: colors.card,
    padding: spacing.sm,
    borderRadius: radii.sm,
  },
  retry: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.ink,
    marginTop: spacing.xs,
  },
  retryPressed: { backgroundColor: colors.inkSoft },
  retryLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
  },

  // details disclosure
  detailsBlock: { gap: spacing.sm },
  detailsToggle: {
    ...typography.labelSmall,
    color: colors.textMute,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  detailsRows: {
    backgroundColor: colors.paperDeep,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailRow: { gap: 2 },
  detailLabel: { ...typography.labelSmall, color: colors.textMute },
  detailValue: { ...typography.mono, color: colors.ink, fontSize: 11 },
  detailValueLink: { color: colors.emeraldDeep, textDecorationLine: 'underline' },

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
  secondaryDisabled: { borderColor: colors.paperDeep, backgroundColor: colors.paperDeep },
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
