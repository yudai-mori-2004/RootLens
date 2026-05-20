import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Buffer } from 'buffer';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import Svg, { Path } from 'react-native-svg';
import { getBuyerPubkey, getBuyerSigner, getDemoWalletPubkey } from '../domain/wallet';
import { config } from '../config';
import { LICENSE_URLS, LICENSE_PRICE_USDC } from '../domain/licenseCatalog';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// 一時的な「買い手シミュレーター」画面。
// 本来 RootLens は売り手側 (撮影者) のアプリなので、これは demo 用途で
// Settings タブの位置に間借りしている。本番では SettingsScreen に戻す。
//
// フロー:
//   1) supplier wallet の staked cNFT を DAS で列挙
//   2) ユーザがどれか選ぶ → POST /api/v1/license/issue
//   3) gateway が delegate 署名済の VersionedTransaction (base64) を返す
//   4) 端末で buyer keypair で additional sign → sendRawTransaction
//   5) 確認 → 買えたカードを「License acquired」に切替
//
// 価格 / license type はカタログ依存。今は commercial-v1 だけハードコード ($1)。

const ENV = process.env as Record<string, string | undefined>;
const SOLANA_RPC_URL = ENV.EXPO_PUBLIC_SOLANA_RPC_URL;
if (!SOLANA_RPC_URL) {
  throw new Error('EXPO_PUBLIC_SOLANA_RPC_URL is not set.');
}
const DAS_URL = ENV.EXPO_PUBLIC_DAS_URL ?? SOLANA_RPC_URL;

// licenseCatalog (= web 側 catalog のミラー) から URL と価格を取る。
// 旧版は 0000...0000 の placeholder URL を焼いていたので co-sign API でマッチせず常に reject
// される silent fake になっていた。
const COMMERCIAL_LICENSE_URL = LICENSE_URLS['commercial-v1'];
const COMMERCIAL_PRICE_USDC = LICENSE_PRICE_USDC['commercial-v1'];

// ----- helpers ---------------------------------------------------------

interface ListedClip {
  assetId: string;
  staked: boolean;
}

type BuyState =
  | { kind: 'idle' }
  | { kind: 'sending'; assetId: string }
  | { kind: 'bought'; assetId: string; txSig: string }
  | { kind: 'error'; assetId: string; message: string };

// ----- screen ----------------------------------------------------------

export const BuyerScreen: React.FC = () => {
  const buyerPubkey = useMemo(() => getBuyerPubkey(), []);
  const buyerSigner = useMemo(() => getBuyerSigner(), []);
  const supplierPubkey = useMemo(() => getDemoWalletPubkey(), []);

  const [clips, setClips] = useState<ListedClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [buy, setBuy] = useState<BuyState>({ kind: 'idle' });
  const [boughtSet, setBoughtSet] = useState<Set<string>>(() => new Set());

  const fetchClips = useCallback(async () => {
    if (!supplierPubkey) {
      setClips([]);
      return;
    }
    setError(null);
    try {
      const res = await fetch(DAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'rl-buyer-listing', method: 'getAssetsByOwner',
          params: {
            ownerAddress: supplierPubkey.toBase58(),
            page: 1, limit: 100,
            sortBy: { sortBy: 'created', sortDirection: 'desc' },
          },
        }),
      });
      const json = await res.json();
      const all: any[] = json?.result?.items ?? [];
      const listed: ListedClip[] = all
        .filter((a) => a?.compression?.compressed === true)
        .map((a) => {
          const owner = a?.ownership?.owner ?? '';
          const delegate = a?.ownership?.delegate ?? null;
          return {
            assetId: String(a.id),
            staked: !!(delegate && delegate !== owner),
          };
        });
      setClips(listed);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setClips([]);
    }
  }, [supplierPubkey]);

  useEffect(() => { fetchClips(); }, [fetchClips]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchClips();
    setRefreshing(false);
  }, [fetchClips]);

  const buyOne = useCallback(async (clip: ListedClip) => {
    if (!buyerPubkey || !buyerSigner) {
      setBuy({ kind: 'error', assetId: clip.assetId, message: 'no buyer wallet configured' });
      return;
    }
    setBuy({ kind: 'sending', assetId: clip.assetId });
    try {
      // 1) License Issue API を叩いて partial-signed tx を貰う
      const res = await fetch(config.licenseIssueUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rootAssetId: clip.assetId,
          licenseUrl: COMMERCIAL_LICENSE_URL,
          buyerAddress: buyerPubkey.toBase58(),
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<no body>');
        throw new Error(`co-sign ${res.status}: ${errBody.slice(0, 200)}`);
      }
      const json = (await res.json()) as { partialSignedTx?: string; error?: string };
      if (!json.partialSignedTx) {
        throw new Error(json.error ?? 'no partialSignedTx in response');
      }

      // 2) base64 → VersionedTransaction → buyer sign
      const txBytes = Buffer.from(json.partialSignedTx, 'base64');
      const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
      tx.sign([buyerSigner]);

      // 3) broadcast + confirm
      const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
      const sig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      const blockhash = await conn.getLatestBlockhash('confirmed');
      await conn.confirmTransaction(
        { signature: sig, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        'confirmed',
      );

      setBoughtSet((prev) => {
        const next = new Set(prev);
        next.add(clip.assetId);
        return next;
      });
      setBuy({ kind: 'bought', assetId: clip.assetId, txSig: sig });
    } catch (e: any) {
      setBuy({ kind: 'error', assetId: clip.assetId, message: e?.message ?? String(e) });
    }
  }, [buyerPubkey, buyerSigner]);

  // ---- render -----------------------------------------------------------

  if (!buyerPubkey || !buyerSigner) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.eyebrow}>BUYER SIMULATOR</Text>
        <Text style={styles.errMessage}>
          No buyer wallet configured. Set EXPO_PUBLIC_BUYER_WALLET_ADDRESS and
          EXPO_PUBLIC_BUYER_KEYPAIR_BASE58 in app/.env.
        </Text>
      </SafeAreaView>
    );
  }

  const buyerShort = `${buyerPubkey.toBase58().slice(0, 4)}…${buyerPubkey.toBase58().slice(-4)}`;

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={clips ?? []}
        keyExtractor={(c) => c.assetId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View>
                <Text style={styles.eyebrow}>BUYER SIMULATOR</Text>
                <Text style={styles.title}>Marketplace</Text>
              </View>
              <View style={styles.walletPill}>
                <View style={styles.walletDot} />
                <Text style={styles.walletPillText}>{buyerShort}</Text>
              </View>
            </View>
            <Text style={styles.lede}>
              You’re an AI lab. Browse staked clips and license one. USDC settles on-chain in a single tx.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            loading={clips === null}
            error={error}
            hasSupplier={!!supplierPubkey}
          />
        }
        renderItem={({ item }) => (
          <ClipCard
            clip={item}
            buying={buy.kind === 'sending' && buy.assetId === item.assetId}
            bought={boughtSet.has(item.assetId)}
            txSig={buy.kind === 'bought' && buy.assetId === item.assetId ? buy.txSig : null}
            error={buy.kind === 'error' && buy.assetId === item.assetId ? buy.message : null}
            onBuy={() => buyOne(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
    </SafeAreaView>
  );
};

// ---- ClipCard ---------------------------------------------------------

const ClipCard: React.FC<{
  clip: ListedClip;
  buying: boolean;
  bought: boolean;
  txSig: string | null;
  error: string | null;
  onBuy: () => void;
}> = ({ clip, buying, bought, txSig, error, onBuy }) => {
  // Root NFT の signedJson には task_id を焼き込んでいないので、 ここでは
  // 「タスク不明」 として扱う (= 以前の simpleHash による推測は乱数同然だったので撤去)。
  // 将来 Title Protocol register 時に task_id を extensionInputs に含めて、 ここで
  // DAS の json_uri 経由で取得するか、 別 endpoint で解決する。
  const canBuy = clip.staked && !buying && !bought;

  return (
    <View style={[styles.card, bought && styles.cardBought]}>
      <View style={styles.cardTop}>
        <View style={[styles.thumb, styles.thumbPlaceholder]} />
        <View style={styles.cardMid}>
          <Text style={styles.cardName} numberOfLines={1}>タスク不明</Text>
          <Text style={styles.cardId} numberOfLines={1}>{clip.assetId}</Text>
          <View style={styles.cardChips}>
            <View
              style={[
                styles.statusChip,
                clip.staked ? styles.statusChipStaked : styles.statusChipUnstaked,
              ]}
            >
              <Text
                style={[
                  styles.statusChipText,
                  { color: clip.staked ? colors.emeraldDeep : colors.textMute },
                ]}
              >
                {clip.staked ? 'LICENSABLE' : 'NOT STAKED'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.cardBottom}>
        {bought && txSig ? (
          <Pressable
            onPress={() => Linking.openURL(`https://solscan.io/tx/${txSig}?cluster=devnet`).catch(() => {})}
            style={({ pressed }) => [styles.boughtRow, pressed && { opacity: 0.7 }]}
          >
            <CheckIcon />
            <Text style={styles.boughtText}>License acquired — tap to view tx</Text>
          </Pressable>
        ) : error ? (
          <Text style={styles.errorText} numberOfLines={3}>
            {error}
          </Text>
        ) : (
          <Pressable
            onPress={onBuy}
            disabled={!canBuy}
            style={({ pressed }) => [
              styles.buyButton,
              !canBuy && styles.buyButtonDisabled,
              pressed && canBuy && styles.buyButtonPressed,
            ]}
          >
            {buying ? (
              <ActivityIndicator size="small" color={colors.textOnInk} />
            ) : (
              <>
                <Text style={[styles.buyLabel, !clip.staked && styles.buyLabelDisabled]}>
                  Buy commercial license
                </Text>
                <Text style={[styles.buyPrice, !clip.staked && styles.buyLabelDisabled]}>
                  ${COMMERCIAL_PRICE_USDC.toFixed(2)} USDC
                </Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
};

const CheckIcon: React.FC = () => (
  <View style={styles.boughtCheck}>
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={colors.card} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </View>
);

// ---- empty/loading ----------------------------------------------------

const EmptyState: React.FC<{ loading: boolean; error: string | null; hasSupplier: boolean }> = ({
  loading, error, hasSupplier,
}) => {
  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.ink} />
        <Text style={styles.emptyText}>Loading clips…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEyebrow}>DAS ERROR</Text>
        <Text style={styles.emptyText}>{error}</Text>
      </View>
    );
  }
  if (!hasSupplier) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEyebrow}>NO SUPPLIER WALLET</Text>
        <Text style={styles.emptyText}>
          Set EXPO_PUBLIC_DEMO_WALLET_ADDRESS so the buyer knows whose clips to browse.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEyebrow}>NOTHING ON MARKET</Text>
      <Text style={styles.emptyText}>
        Switch to Job, record a clip, mint and stake it. Then pull-to-refresh here.
      </Text>
    </View>
  );
};

// ---- styles -----------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },

  header: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  eyebrow: { ...typography.label, color: colors.textMute },
  title: {
    fontFamily: fonts.serifSemibold,
    fontSize: 32,
    letterSpacing: -0.5,
    color: colors.ink,
    marginTop: 2,
  },
  lede: {
    ...typography.body,
    color: colors.textBody,
    fontSize: 14.5,
    lineHeight: 21,
  },
  walletPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginTop: spacing.xs,
  },
  walletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald },
  walletPillText: {
    ...typography.mono,
    fontSize: 11,
    color: colors.textBody,
  },

  // card
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  cardBought: {
    borderColor: colors.borderEmerald,
    borderWidth: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: {
    width: 64, height: 64,
    backgroundColor: colors.paper,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
  },
  thumbImg: { width: '80%', height: '80%' },
  thumbPlaceholder: { opacity: 0.5 },
  cardMid: { flex: 1, gap: 2 },
  cardName: {
    fontFamily: fonts.serifMedium,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  cardId: {
    ...typography.mono,
    fontSize: 11,
    color: colors.textFaint,
  },
  cardChips: { flexDirection: 'row', gap: 6, marginTop: 6 },
  statusChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  statusChipStaked: {
    backgroundColor: colors.emeraldSoft,
    borderColor: colors.borderEmerald,
  },
  statusChipUnstaked: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  statusChipText: { ...typography.labelSmall },

  cardBottom: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  buyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.ink,
    borderRadius: radii.md,
    minHeight: 50,
  },
  buyButtonPressed: { backgroundColor: colors.inkSoft },
  buyButtonDisabled: { backgroundColor: colors.paperDeep },
  buyLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
  },
  buyPrice: {
    color: colors.textOnInk,
    fontFamily: fonts.mono,
    fontSize: 14,
  },
  buyLabelDisabled: { color: colors.textFaint },

  boughtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  boughtCheck: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.emerald,
    alignItems: 'center', justifyContent: 'center',
  },
  boughtText: {
    ...typography.body,
    color: colors.emeraldDeep,
    fontFamily: fonts.sansMedium,
    fontSize: 13.5,
  },

  errorText: {
    ...typography.caption,
    color: colors.danger,
    paddingVertical: spacing.sm,
  },
  errMessage: {
    ...typography.body,
    color: colors.textBody,
    textAlign: 'center',
    maxWidth: 320,
  },

  // empty
  empty: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyEyebrow: { ...typography.label, color: colors.textMute },
  emptyText: {
    ...typography.body,
    color: colors.textBody,
    textAlign: 'center',
    maxWidth: 320,
  },
});
