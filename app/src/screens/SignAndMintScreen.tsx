import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { findTask } from '../domain/taskCatalog';
import { getDemoWalletPubkey } from '../domain/wallet';
import { signContent } from '../native/c2paBridge';
import { registerOnTitleProtocol } from '../services/titleProtocol';
import { config } from '../config';
import { colors, typography, spacing, radii } from '../theme';

// SPECS_JA §2.7 + §3 + §4.3:
//   1) C2PA sign  (Unit A) — TEE 鍵で動画に C2PA manifest を埋める
//   2) TP register (Unit B) — TP gateway が C2PA + perceptual hash を検証 → Root NFT mint
//   3) R2 upload  (Unit F) — buyer が後で content_hash 経由で取れるよう公開ストレージへ
//
// 各 step を順番に await。エラーで止まったら retry を出す。

type Props = NativeStackScreenProps<RootStackParamList, 'SignAndMint'>;

type StepState =
  | { kind: 'pending' }
  | { kind: 'running' }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string };

export const SignAndMintScreen: React.FC<Props> = ({ route, navigation }) => {
  const { taskId, processedVideoUri } = route.params;
  const task = findTask(taskId);
  // useMemo で固定。さもないと render 毎に new PublicKey が走り、
  // useEffect deps が変わったと判定されて無限ループする。
  const ownerPubkey = useMemo(() => getDemoWalletPubkey(), []);

  const [c2paStep, setC2paStep] = useState<StepState>({ kind: 'pending' });
  const [tpStep, setTpStep] = useState<StepState>({ kind: 'pending' });
  const [r2Step, setR2Step] = useState<StepState>({ kind: 'pending' });

  const [signedUri, setSignedUri] = useState<string | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!ownerPubkey || !task) return;
    let cancelled = false;
    (async () => {
      // Step 1: C2PA sign (skip if Android — Android stub に飛ぶと throw する)
      let signedPath = processedVideoUri;
      if (Platform.OS === 'ios') {
        setC2paStep({ kind: 'running' });
        try {
          const out = await signContent(processedVideoUri.replace(/^file:\/\//, ''), [
            { label: 'rootlens.task', data: { task_id: taskId, task_name: task.name } },
          ]);
          if (cancelled) return;
          signedPath = out.startsWith('file://') ? out : `file://${out}`;
          setSignedUri(signedPath);
          setC2paStep({ kind: 'done', summary: 'TEE-signed mp4 generated' });
        } catch (err: any) {
          if (cancelled) return;
          setC2paStep({ kind: 'error', message: err?.message ?? String(err) });
          return;
        }
      } else {
        setC2paStep({ kind: 'done', summary: 'Skipped (Android C2PA stub) — proceeding unsigned' });
        setSignedUri(processedVideoUri);
      }

      // Step 2: TP register
      setTpStep({ kind: 'running' });
      let hash = '';
      let tx = '';
      try {
        const cleanPath = signedPath.replace(/^file:\/\//, '');
        const r = await registerOnTitleProtocol(cleanPath, ownerPubkey.toBase58(), 'RootLens', 'video');
        if (cancelled) return;
        // TP の content_hash は "0x" + 64hex の形式 (Rust verify::format_content_hash)。
        // R2 (Unit F) の normalizeContentHash は prefix を許容するが、ここで剥がして bare hex に統一する。
        hash = r.contentHash.replace(/^0x/i, '').toLowerCase();
        tx = r.txSignature;
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          throw new Error(`TP returned malformed content_hash: "${r.contentHash}" (after strip: "${hash}")`);
        }
        setContentHash(hash);
        setMintTx(tx);
        setTpStep({ kind: 'done', summary: `Root NFT minted · tx ${tx.slice(0, 8)}…` });
      } catch (err: any) {
        if (cancelled) return;
        setTpStep({ kind: 'error', message: err?.message ?? String(err) });
        return;
      }

      // Step 3: R2 upload (buyer-facing storage)
      setR2Step({ kind: 'running' });
      try {
        const sizeInfo = await FileSystem.getInfoAsync(signedPath);
        if (!sizeInfo.exists) throw new Error('signed mp4 missing on disk');
        const presignRes = await fetch(config.uploadUrlEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content_hash: hash.toLowerCase(),
            kind: 'media',
            contentType: 'video/mp4',
          }),
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
        setR2Step({
          kind: 'done',
          summary:
            presign.status === 'new'
              ? `Uploaded to R2 (${presign.publicUrl})`
              : `Already in R2 (dedup hit)`,
        });

        // 自動遷移はせず、ユーザに次のステップを選ばせる (stake or skip)
      } catch (err: any) {
        if (cancelled) return;
        setR2Step({ kind: 'error', message: err?.message ?? String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [runId, processedVideoUri, taskId, task, ownerPubkey]);

  const allDone = c2paStep.kind === 'done' && tpStep.kind === 'done' && r2Step.kind === 'done';
  const goStake = () => {
    if (!contentHash || !mintTx) return;
    navigation.replace('Stake', {
      taskId,
      rootNftAssetId: '', // discover via DAS in StakeScreen
      mintTxSignature: mintTx,
      contentHash,
      publicUrl,
    });
  };
  const skipStake = () => {
    if (!contentHash) return;
    navigation.replace('Done', {
      taskId,
      rootNftAssetId: '',
      contentHash,
      staked: false,
      stakeTxSignature: null,
    });
  };

  if (!ownerPubkey) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>No demo wallet — set EXPO_PUBLIC_DEMO_WALLET_ADDRESS.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>MINT</Text>
        <Text style={styles.heading}>Sign & register on Solana</Text>
        <Text style={styles.lede}>
          Three steps: TEE-sign the mp4, register with Title Protocol, upload to R2.
        </Text>

        <StepRow label="1 · C2PA sign (Unit A)" state={c2paStep} />
        <StepRow label="2 · Title Protocol register (Unit B)" state={tpStep} />
        <StepRow label="3 · R2 upload (Unit F)" state={r2Step} />

        {publicUrl ? (
          <Pressable onPress={() => Linking.openURL(publicUrl)} style={styles.linkRow}>
            <Text style={styles.linkLabel}>R2 public URL</Text>
            <Text style={styles.linkValue} numberOfLines={1}>{publicUrl}</Text>
          </Pressable>
        ) : null}
        {mintTx ? (
          <Pressable
            onPress={() => Linking.openURL(`https://solscan.io/tx/${mintTx}?cluster=devnet`)}
            style={styles.linkRow}
          >
            <Text style={styles.linkLabel}>Mint tx (Solscan devnet)</Text>
            <Text style={styles.linkValue} numberOfLines={1}>{mintTx}</Text>
          </Pressable>
        ) : null}

        {(c2paStep.kind === 'error' || tpStep.kind === 'error' || r2Step.kind === 'error') && (
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            onPress={() => {
              setC2paStep({ kind: 'pending' });
              setTpStep({ kind: 'pending' });
              setR2Step({ kind: 'pending' });
              setSignedUri(null);
              setContentHash(null);
              setMintTx(null);
              setPublicUrl(null);
              setRunId((n) => n + 1);
            }}
          >
            <Text style={styles.retryLabel}>↻ Retry</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          onPress={skipStake}
          disabled={!allDone}
        >
          <Text style={[styles.secondaryLabel, !allDone && { color: colors.textDisabled }]}>
            Skip stake
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.cta,
            !allDone && styles.ctaDisabled,
            pressed && allDone && styles.ctaPressed,
          ]}
          onPress={goStake}
          disabled={!allDone}
        >
          <Text style={styles.ctaLabel}>Stake & continue →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const StepRow: React.FC<{ label: string; state: StepState }> = ({ label, state }) => {
  const dotColor =
    state.kind === 'done' ? colors.success :
    state.kind === 'error' ? colors.error :
    state.kind === 'running' ? colors.accent :
    colors.textHint;
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.stepLabel}>{label}</Text>
        {state.kind === 'running' && (
          <View style={styles.stepStatus}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.stepStatusText}>In progress…</Text>
          </View>
        )}
        {state.kind === 'done' && <Text style={styles.stepDoneText}>{state.summary}</Text>}
        {state.kind === 'error' && <Text style={styles.stepErrorText}>{state.message}</Text>}
        {state.kind === 'pending' && <Text style={styles.stepPendingText}>Waiting…</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  eyebrow: { ...typography.label, color: colors.textSecondary, letterSpacing: 1.6 },
  heading: { ...typography.heading, color: colors.textPrimary },
  lede: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },

  stepRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  stepDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  stepLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  stepStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  stepStatusText: { ...typography.caption, color: colors.textSecondary },
  stepDoneText: { ...typography.caption, color: colors.success, marginTop: 4 },
  stepErrorText: { ...typography.caption, color: colors.error, marginTop: 4 },
  stepPendingText: { ...typography.caption, color: colors.textHint, marginTop: 4 },

  linkRow: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.sm,
    gap: 2, marginTop: spacing.xs,
  },
  linkLabel: { ...typography.label, color: colors.textSecondary, letterSpacing: 1.2 },
  linkValue: { fontFamily: 'Menlo', fontSize: 11, color: colors.accent },

  retry: {
    marginTop: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent, borderRadius: radii.md, alignItems: 'center',
  },
  retryPressed: { backgroundColor: colors.accentDark },
  retryLabel: { color: colors.white, ...typography.bodyMedium },

  footer: {
    flexDirection: 'row', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.background,
  },
  secondary: {
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, alignItems: 'center',
  },
  secondaryPressed: { backgroundColor: colors.surface },
  secondaryLabel: { ...typography.bodyMedium, color: colors.textPrimary },
  cta: {
    flex: 1, paddingVertical: spacing.md, borderRadius: radii.md,
    backgroundColor: colors.accent, alignItems: 'center',
  },
  ctaPressed: { backgroundColor: colors.accentDark },
  ctaDisabled: { backgroundColor: colors.textDisabled },
  ctaLabel: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
