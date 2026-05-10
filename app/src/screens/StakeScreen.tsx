import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { buildStakeIx } from '../services/staking';
import { getDemoSigner, getDemoWalletPubkey } from '../domain/wallet';
import { colors, typography, spacing, radii } from '../theme';

// SPECS_JA §4.5: Root NFT の delegate を RootLens の cosign authority に切替 → 「ステーキング」。
// 1) DAS で demo wallet 所有の cNFT を列挙し最新を選ぶ (mint 直後を想定)
// 2) buildStakeIx (Unit G) で delegateV2 IX を組む
// 3) demo keypair で署名 → broadcast
//
// 鍵が無い (DEMO_KEYPAIR 未設定) または cosign authority が無い場合は skip ボタンのみ。

const ENV = process.env as Record<string, string | undefined>;
// Solana 公式 devnet RPC は DAS API (getAssetsByOwner 等) も提供している。
// Helius は devnet サポートを縮退したので、特に env で上書きしない限り公式 RPC を使う。
const SOLANA_RPC_URL = ENV.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const DAS_URL = ENV.EXPO_PUBLIC_DAS_URL ?? SOLANA_RPC_URL;
const COSIGN_AUTHORITY = ENV.EXPO_PUBLIC_COSIGN_AUTHORITY ?? '';

type Props = NativeStackScreenProps<RootStackParamList, 'Stake'>;

type Discovery =
  | { kind: 'pending' }
  | { kind: 'found'; assetId: string; ownerStr: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

type Tx =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; signature: string }
  | { kind: 'error'; message: string };

export const StakeScreen: React.FC<Props> = ({ route, navigation }) => {
  const { taskId, contentHash, mintTxSignature } = route.params;
  // useMemo で固定。さもないと render 毎に new PublicKey / new Keypair が走り、
  // useEffect deps が変わったと判定されて無限ループする。
  const ownerPubkey = useMemo(() => getDemoWalletPubkey(), []);
  const signer = useMemo(() => getDemoSigner(), []);
  const cosignAuthorityPk = useMemo(() => {
    try { return COSIGN_AUTHORITY ? new PublicKey(COSIGN_AUTHORITY) : null; } catch { return null; }
  }, []);

  const [discovery, setDiscovery] = useState<Discovery>({ kind: 'pending' });
  const [tx, setTx] = useState<Tx>({ kind: 'idle' });

  useEffect(() => {
    if (!ownerPubkey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(DAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'rl-stake-discovery',
            method: 'getAssetsByOwner',
            params: {
              ownerAddress: ownerPubkey.toBase58(),
              page: 1,
              limit: 50,
              sortBy: { sortBy: 'created', sortDirection: 'desc' },
            },
          }),
        });
        const json = await res.json();
        const items: any[] = json?.result?.items ?? [];
        // Filter to compressed NFTs only (Root NFT is cNFT)
        const compressed = items.filter((i) => i?.compression?.compressed === true);
        if (cancelled) return;
        if (compressed.length === 0) {
          setDiscovery({ kind: 'none' });
          return;
        }
        const top = compressed[0];
        setDiscovery({
          kind: 'found',
          assetId: String(top.id),
          ownerStr: ownerPubkey.toBase58(),
        });
      } catch (err: any) {
        if (cancelled) return;
        setDiscovery({ kind: 'error', message: err?.message ?? String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [ownerPubkey]);

  const canStake =
    discovery.kind === 'found' &&
    !!signer &&
    !!cosignAuthorityPk &&
    !!ownerPubkey &&
    tx.kind !== 'sending';

  const stake = async () => {
    if (discovery.kind !== 'found' || !signer || !cosignAuthorityPk || !ownerPubkey) return;
    setTx({ kind: 'sending' });
    try {
      const ix = await buildStakeIx({
        rootAssetId: new PublicKey(discovery.assetId),
        currentOwner: ownerPubkey,
        cosignAuthority: cosignAuthorityPk,
        dasUrl: DAS_URL,
      });
      const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
      const txObj = new Transaction().add(ix);
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      txObj.recentBlockhash = blockhash;
      txObj.feePayer = signer.publicKey;
      txObj.sign(signer);
      const sig = await conn.sendRawTransaction(txObj.serialize(), {
        skipPreflight: false,
      });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: (await conn.getLatestBlockhash()).lastValidBlockHeight }, 'confirmed');
      setTx({ kind: 'sent', signature: sig });
      navigation.replace('Done', {
        taskId,
        rootNftAssetId: discovery.assetId,
        contentHash,
        staked: true,
        stakeTxSignature: sig,
      });
    } catch (err: any) {
      setTx({ kind: 'error', message: err?.message ?? String(err) });
    }
  };

  const skip = () => {
    navigation.replace('Done', {
      taskId,
      rootNftAssetId: discovery.kind === 'found' ? discovery.assetId : '',
      contentHash,
      staked: false,
      stakeTxSignature: null,
    });
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>STAKE</Text>
        <Text style={styles.heading}>Set RootLens as delegate</Text>
        <Text style={styles.lede}>
          Staking lets RootLens co-sign License NFT issuance on your behalf. Revenue (95% to you, 5% to RootLens) is split atomically by the on-chain program when buyers purchase a license. You can unstake any time to disable issuance.
        </Text>

        <Section title="Mint result">
          <Field label="Content hash" value={contentHash} mono />
          <Field label="Mint tx" value={mintTxSignature} mono link={`https://solscan.io/tx/${mintTxSignature}?cluster=devnet`} />
        </Section>

        <Section title="Root NFT discovery (DAS)">
          {discovery.kind === 'pending' && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.body}>Searching DAS for newly minted cNFT…</Text>
            </View>
          )}
          {discovery.kind === 'found' && (
            <Field label="Asset id" value={discovery.assetId} mono />
          )}
          {discovery.kind === 'none' && (
            <Text style={styles.errorText}>
              No compressed NFT found in this wallet yet. DAS may need a few seconds to index — refresh in a moment.
            </Text>
          )}
          {discovery.kind === 'error' && (
            <Text style={styles.errorText}>DAS error: {discovery.message}</Text>
          )}
        </Section>

        <Section title="Wallet">
          <Field label="Owner" value={ownerPubkey?.toBase58() ?? '—'} mono />
          <Field
            label="Cosign authority"
            value={COSIGN_AUTHORITY || '(not configured — set EXPO_PUBLIC_COSIGN_AUTHORITY)'}
            mono
          />
          {!signer && (
            <Text style={styles.errorText}>
              No signer keypair — set EXPO_PUBLIC_DEMO_KEYPAIR_BASE58 to enable stake.
            </Text>
          )}
        </Section>

        {tx.kind === 'sending' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.body}>Broadcasting stake tx…</Text>
          </View>
        )}
        {tx.kind === 'error' && <Text style={styles.errorText}>Stake failed: {tx.message}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          onPress={skip}
        >
          <Text style={styles.secondaryLabel}>Skip stake</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.cta,
            !canStake && styles.ctaDisabled,
            pressed && canStake && styles.ctaPressed,
          ]}
          onPress={stake}
          disabled={!canStake}
        >
          <Text style={styles.ctaLabel}>
            {tx.kind === 'sending' ? 'Sending…' : 'Stake →'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

// --- helpers ---

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Field: React.FC<{ label: string; value: string; mono?: boolean; link?: string }> = ({ label, value, mono, link }) => {
  const valueEl = (
    <Text style={[styles.fieldValue, mono && styles.fieldValueMono]} numberOfLines={1}>
      {value}
    </Text>
  );
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {link ? (
        <Pressable onPress={() => Linking.openURL(link)}>{valueEl}</Pressable>
      ) : (
        valueEl
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  eyebrow: { ...typography.label, color: colors.textSecondary, letterSpacing: 1.6 },
  heading: { ...typography.heading, color: colors.textPrimary },
  lede: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textPrimary },
  errorText: { ...typography.caption, color: colors.error, marginTop: spacing.xs },

  section: {
    paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
    gap: spacing.xs,
  },
  sectionTitle: { ...typography.captionMedium, color: colors.textPrimary, marginBottom: spacing.xs },

  field: { paddingVertical: spacing.xs, gap: 2 },
  fieldLabel: { ...typography.label, color: colors.textHint, letterSpacing: 1.2 },
  fieldValue: { ...typography.body, color: colors.textPrimary },
  fieldValueMono: { fontFamily: 'Menlo', fontSize: 11 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },

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
