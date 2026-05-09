import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TaskDef } from '../tasks';
import { colors, fonts, radius, space, type } from '../theme';
import { registerOnTitleProtocol, type TitleProtocolResult } from '../../../services/titleProtocol';

const DEMO_WALLET_ADDRESS = process.env.EXPO_PUBLIC_DEMO_WALLET_ADDRESS ?? '';

interface Props {
  task: TaskDef;
  videoUri: string | null;
  score: number | null;
  onDone: () => void;
  onCancel: () => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'minting' }
  | { kind: 'minted'; result: TitleProtocolResult }
  | { kind: 'error'; message: string };

const BULLETS: { title: string; body: string }[] = [
  {
    title: 'License issuance right',
    body: 'Holding the Core NFT lets you issue licenses for this clip to third parties.',
  },
  {
    title: 'You keep the copyright',
    body: 'The NFT is not the copyright. You grant sublicensable rights through the Terms of Use.',
  },
  {
    title: 'Title Protocol verified',
    body: 'Issued only after Title Protocol verifies the device-attached signature.',
  },
];

export const MintView: React.FC<Props> = ({ task, videoUri, score, onDone, onCancel }) => {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const canMint = !!videoUri && !!DEMO_WALLET_ADDRESS;
  const ownerShort = DEMO_WALLET_ADDRESS
    ? `${DEMO_WALLET_ADDRESS.slice(0, 6)}…${DEMO_WALLET_ADDRESS.slice(-6)}`
    : '—';

  const handleMint = useCallback(async () => {
    if (!videoUri || !DEMO_WALLET_ADDRESS) return;
    setState({ kind: 'minting' });
    try {
      const cleanPath = videoUri.replace(/^file:\/\//, '');
      const result = await registerOnTitleProtocol(cleanPath, DEMO_WALLET_ADDRESS, 'RootLens', 'video');
      console.log('[MintView] TP register OK:', result);
      setState({ kind: 'minted', result });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.warn('[MintView] TP register failed:', message);
      setState({ kind: 'error', message });
    }
  }, [videoUri]);

  if (state.kind === 'minted') {
    return <MintedView task={task} score={score} result={state.result} onDone={onDone} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.backLink}>← Result</Text>
        </Pressable>
        <Text style={styles.contextLine} numberOfLines={1}>
          {task.name}{score !== null ? ` · score ${score}` : ''}
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.eyebrow}>MINT CORE NFT</Text>
        <Text style={styles.headline}>
          Turn this clip into a{'\n'}Core NFT on Solana.
        </Text>

        <View style={styles.bullets}>
          {BULLETS.map((b, i) => (
            <View key={b.title} style={[styles.bullet, i > 0 && styles.bulletDivider]}>
              <Text style={styles.bulletTitle}>{b.title}</Text>
              <Text style={styles.bulletBody}>{b.body}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.ownerLine}>owner: {ownerShort}</Text>
      </View>

      <View style={styles.bar}>
        {state.kind === 'error' ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorLabel}>MINT FAILED</Text>
            <Text style={styles.errorText} numberOfLines={3}>{state.message}</Text>
          </View>
        ) : null}

        {state.kind === 'minting' ? (
          <View style={styles.progressRow}>
            <ActivityIndicator color={colors.bgInk} />
            <Text style={styles.progressText}>
              Encrypt → Upload → Verify → Sign on Solana
            </Text>
          </View>
        ) : (
          <>
            <Pressable
              style={({ pressed }) => [styles.cta, !canMint && styles.ctaDisabled, pressed && canMint && styles.ctaPressed]}
              onPress={handleMint}
              disabled={!canMint}
            >
              <Text style={[styles.ctaLabel, !canMint && styles.ctaLabelDisabled]}>
                {!canMint
                  ? 'Wallet not configured'
                  : state.kind === 'error' ? 'Try again' : 'I agree — mint Core NFT'}
              </Text>
            </Pressable>
            <Pressable onPress={onCancel} hitSlop={8} style={styles.skipBtn}>
              <Text style={styles.skipLabel}>Skip</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
};

// ---- Minted (success) view ----------------------------------------------

const MintedView: React.FC<{
  task: TaskDef;
  score: number | null;
  result: TitleProtocolResult;
  onDone: () => void;
}> = ({ task, score, result, onDone }) => {
  const explorerUrl = result.txSignature
    ? `https://solscan.io/tx/${result.txSignature}?cluster=devnet`
    : null;
  const openExplorer = useCallback(() => {
    if (explorerUrl) Linking.openURL(explorerUrl).catch(() => {});
  }, [explorerUrl]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.contextLine} numberOfLines={1}>
          {task.name}{score !== null ? ` · score ${score}` : ''}
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.mintedEyebrow}>✓ MINTED</Text>
        <Text style={styles.headline}>
          Core NFT issued{'\n'}on Solana devnet.
        </Text>

        <View style={styles.kvList}>
          <KvRow label="Hash"  value={result.contentHash || '—'} />
          <KvRow label="Tx"    value={result.txSignature || '—'} />
          <KvRow label="Owner" value={DEMO_WALLET_ADDRESS || '—'} />
        </View>

        {explorerUrl ? (
          <Pressable onPress={openExplorer} hitSlop={8}>
            <Text style={styles.explorerLink}>Open in Solscan ↗</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.bar}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={onDone}
        >
          <Text style={styles.ctaLabel}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
};

const KvRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.kvRow}>
    <Text style={styles.kvLabel}>{label}</Text>
    <Text style={styles.kvValue} numberOfLines={1}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgWarm },

  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.l,
    paddingBottom: space.m,
    gap: space.xs,
  },
  backLink: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: colors.textInk,
  },
  contextLine: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.textMute,
  },

  body: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.l,
    gap: space.l,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.textMute,
    fontWeight: '700',
  },
  mintedEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.statusOk,
    fontWeight: '700',
  },
  headline: {
    fontFamily: fonts.displayLight,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: colors.textInk,
  },

  bullets: {
    marginTop: space.s,
  },
  bullet: {
    paddingVertical: space.s,
    gap: 4,
  },
  bulletDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bulletTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: colors.textInk,
    letterSpacing: -0.1,
  },
  bulletBody: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textBody,
  },
  ownerLine: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.textFaint,
    marginTop: space.xs,
  },

  kvList: { marginTop: space.s, gap: space.s },
  kvRow: {
    flexDirection: 'row',
    gap: space.m,
    alignItems: 'baseline',
  },
  kvLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.textMute,
    fontWeight: '600',
    width: 56,
  },
  kvValue: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textInk,
  },
  explorerLink: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: colors.textInk,
    marginTop: space.m,
  },

  bar: {
    paddingHorizontal: space.xl,
    paddingTop: space.m,
    paddingBottom: space.xl,
    backgroundColor: colors.bgWhite,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: space.s,
  },
  cta: {
    backgroundColor: colors.bgInk,
    paddingVertical: space.m,
    borderRadius: radius.s,
    alignItems: 'center',
  },
  ctaPressed: { backgroundColor: colors.bgInkSoft },
  ctaDisabled: { backgroundColor: colors.border },
  ctaLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.displayMedium,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  ctaLabelDisabled: { color: colors.textFaint },
  skipBtn: { paddingVertical: space.s, alignItems: 'center' },
  skipLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMute,
  },

  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.l,
  },
  progressText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.textMute,
    flex: 1,
  },
  errorBox: {
    paddingHorizontal: space.m,
    paddingVertical: space.s,
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
    fontWeight: '700',
  },
  errorText: { ...type.bodyS, color: colors.textBody },
});
