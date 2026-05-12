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
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import Svg, { Path } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { buildStakeIx } from '../services/staking';
import { getDemoSigner, getDemoWalletPubkey } from '../domain/wallet';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// 「RootLens に license 販売を任せていいですか？」フェーズ。
// 内部的には Bubblegum delegateV2 で Root NFT の delegate を切り替えるのが正体だが、
// 初見ユーザに見せる文言は「お任せ販売」軸で揃える。

const ENV = process.env as Record<string, string | undefined>;
const SOLANA_RPC_URL = ENV.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const DAS_URL = ENV.EXPO_PUBLIC_DAS_URL ?? SOLANA_RPC_URL;
const COSIGN_AUTHORITY = ENV.EXPO_PUBLIC_COSIGN_AUTHORITY ?? '';

const HERO_DECOR = require('../../assets/decor/handshake.png');

type Props = NativeStackScreenProps<RootStackParamList, 'Stake'>;

type Discovery =
  | { kind: 'pending' }
  | { kind: 'found'; assetId: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

type Tx =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; signature: string }
  | { kind: 'error'; message: string };

export const StakeScreen: React.FC<Props> = ({ route, navigation }) => {
  const { taskId, contentHash, mintTxSignature } = route.params;
  const ownerPubkey = useMemo(() => getDemoWalletPubkey(), []);
  const signer = useMemo(() => getDemoSigner(), []);
  const cosignAuthorityPk = useMemo(() => {
    try { return COSIGN_AUTHORITY ? new PublicKey(COSIGN_AUTHORITY) : null; } catch { return null; }
  }, []);

  const [discovery, setDiscovery] = useState<Discovery>({ kind: 'pending' });
  const [tx, setTx] = useState<Tx>({ kind: 'idle' });
  const [showDetails, setShowDetails] = useState(false);

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
              page: 1, limit: 50,
              sortBy: { sortBy: 'created', sortDirection: 'desc' },
            },
          }),
        });
        const json = await res.json();
        const items: any[] = json?.result?.items ?? [];
        const compressed = items.filter((i) => i?.compression?.compressed === true);
        if (cancelled) return;
        if (compressed.length === 0) { setDiscovery({ kind: 'none' }); return; }
        setDiscovery({ kind: 'found', assetId: String(compressed[0].id) });
      } catch (err: any) {
        if (cancelled) return;
        setDiscovery({ kind: 'error', message: err?.message ?? String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [ownerPubkey]);

  const canStake =
    discovery.kind === 'found' && !!signer && !!cosignAuthorityPk && !!ownerPubkey && tx.kind !== 'sending';

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
      const sig = await conn.sendRawTransaction(txObj.serialize(), { skipPreflight: false });
      await conn.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight: (await conn.getLatestBlockhash()).lastValidBlockHeight },
        'confirmed',
      );
      setTx({ kind: 'sent', signature: sig });
      navigation.replace('Done', {
        taskId, rootNftAssetId: discovery.assetId, contentHash,
        staked: true, stakeTxSignature: sig,
      });
    } catch (err: any) {
      setTx({ kind: 'error', message: err?.message ?? String(err) });
    }
  };

  const skip = () => {
    navigation.replace('Done', {
      taskId,
      rootNftAssetId: discovery.kind === 'found' ? discovery.assetId : '',
      contentHash, staked: false, stakeTxSignature: null,
    });
  };

  const blockerNote = !signer
    ? 'No signer in this build — stake unavailable.'
    : !cosignAuthorityPk
    ? 'Server keys not configured yet — stake unavailable.'
    : discovery.kind === 'pending'
    ? 'Just looking up your clip on Solana…'
    : discovery.kind === 'none'
    ? 'Your clip hasn’t shown up on Solana yet. Give it a few seconds.'
    : discovery.kind === 'error'
    ? 'Couldn’t reach Solana to look up your clip.'
    : null;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* HERO */}
        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <Text style={styles.eyebrow}>OPTIONAL · ONE TAP</Text>
            <Text style={styles.heroTitle}>Let RootLens sell licenses for you.</Text>
            <Text style={styles.heroSub}>
              We’ll co-sign with you when AI labs request a license. You stay the owner.
              Every sale settles instantly in USDC, on-chain.
            </Text>
          </View>
          <Image source={HERO_DECOR} style={styles.heroDecor} resizeMode="contain" />
        </View>

        {/* THREE GUARANTEES */}
        <View style={styles.guarantees}>
          <Guarantee
            icon="lock"
            title="You stay the owner."
            body="The clip never leaves your wallet. Only license issuance can be co-signed."
          />
          <Guarantee
            icon="undo"
            title="Reversible anytime."
            body="One tap to take back the delegate and stop new licenses being issued."
          />
          <Guarantee
            icon="usd"
            title="Paid instantly."
            body="USDC arrives in your wallet the moment a license is bought — no payouts queue."
          />
        </View>

        {/* Status */}
        {blockerNote && (
          <View style={styles.noteCard}>
            <View style={styles.noteDot} />
            <Text style={styles.noteText}>{blockerNote}</Text>
          </View>
        )}
        {tx.kind === 'sending' && (
          <View style={styles.txCard}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.txText}>Setting it up on Solana…</Text>
          </View>
        )}
        {tx.kind === 'error' && (
          <View style={[styles.txCard, styles.txCardError]}>
            <Text style={styles.txTextError} numberOfLines={3}>
              That didn’t go through. {tx.message}
            </Text>
          </View>
        )}

        {/* Tech disclosure */}
        <View style={styles.detailsBlock}>
          <Pressable
            onPress={() => setShowDetails((v) => !v)}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.detailsToggle}>
              {showDetails ? 'Hide what this does on-chain' : 'What this does on-chain'}
            </Text>
          </Pressable>
          {showDetails && (
            <View style={styles.detailsBox}>
              <Text style={styles.detailsBody}>
                We submit a Bubblegum <Text style={styles.detailsMono}>delegateV2</Text> instruction
                signed by your wallet. It sets the cNFT delegate to the RootLens cosign key — required
                for the License NFT program to mint license cNFTs against your Root NFT and settle USDC
                on-chain.
              </Text>
              <DetailRow
                label="ASSET"
                value={discovery.kind === 'found' ? discovery.assetId : 'discovering…'}
              />
              <DetailRow
                label="DELEGATE"
                value={COSIGN_AUTHORITY || 'not configured'}
              />
              <DetailRow
                label="MINT TX"
                value={mintTxSignature}
                link={`https://solscan.io/tx/${mintTxSignature}?cluster=devnet`}
              />
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.bar}>
        <Pressable
          onPress={skip}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryLabel}>Not now</Text>
        </Pressable>
        <Pressable
          onPress={stake}
          disabled={!canStake}
          style={({ pressed }) => [
            styles.cta,
            !canStake && styles.ctaDisabled,
            pressed && canStake && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaLabel, !canStake && styles.ctaLabelDisabled]}>
            {tx.kind === 'sending' ? 'Sending…' : 'Yes, let’s earn'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

// ---- helpers ---------------------------------------------------------

const Guarantee: React.FC<{
  icon: 'lock' | 'undo' | 'usd';
  title: string;
  body: string;
}> = ({ icon, title, body }) => (
  <View style={styles.guarRow}>
    <View style={styles.guarIconWrap}>
      <GuaranteeIcon kind={icon} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.guarTitle}>{title}</Text>
      <Text style={styles.guarBody}>{body}</Text>
    </View>
  </View>
);

const GuaranteeIcon: React.FC<{ kind: 'lock' | 'undo' | 'usd' }> = ({ kind }) => {
  const stroke = colors.emeraldDeep;
  const sw = 1.6;
  if (kind === 'lock') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path d="M6 11h12v9H6z" stroke={stroke} strokeWidth={sw} />
        <Path d="M9 11V8a3 3 0 016 0v3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </Svg>
    );
  }
  if (kind === 'undo') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path d="M4 8h9a5 5 0 015 5v0a5 5 0 01-5 5H7" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M7 4L4 8l3 4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 4v16M16 8c-1-2-3-2.5-4.5-2.5S8 6 8 7.5 9.5 9.5 12 10s4 1 4 3-2 3-4 3-3.5-1-4-3"
        stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
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

// ---- styles ---------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },

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
  heroLeft: { flex: 1, justifyContent: 'center', gap: spacing.xs },
  eyebrow: { ...typography.label, color: colors.emeraldDeep },
  heroTitle: {
    fontFamily: fonts.serifSemibold,
    fontSize: 24,
    color: colors.ink,
    letterSpacing: -0.4,
    lineHeight: 30,
    marginTop: 2,
  },
  heroSub: {
    ...typography.body,
    color: colors.textBody,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  heroDecor: { width: 96, height: 96 },


  // guarantees
  guarantees: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  guarRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  guarIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.emeraldFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  guarTitle: {
    fontFamily: fonts.serifMedium,
    fontSize: 15,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  guarBody: {
    ...typography.caption,
    color: colors.textBody,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 2,
  },

  // status
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warnSoft,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  noteDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warn,
  },
  noteText: {
    ...typography.caption,
    color: colors.textBody,
    flex: 1,
    fontSize: 13,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  txCardError: {
    borderColor: colors.danger, backgroundColor: colors.dangerSoft,
  },
  txText: { ...typography.body, color: colors.textBody, flex: 1 },
  txTextError: { ...typography.body, color: colors.danger, flex: 1 },

  // details
  detailsBlock: { gap: spacing.sm },
  detailsToggle: {
    ...typography.labelSmall,
    color: colors.textMute,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  detailsBox: {
    backgroundColor: colors.paperDeep,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailsBody: {
    ...typography.caption,
    color: colors.textBody,
    fontSize: 12.5,
    lineHeight: 18,
  },
  detailsMono: {
    fontFamily: fonts.mono,
    fontSize: 11.5,
    color: colors.ink,
  },
  detailRow: { gap: 2, paddingTop: 4 },
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
  secondaryLabel: { fontFamily: fonts.sansSemibold, fontSize: 14, color: colors.ink },
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
