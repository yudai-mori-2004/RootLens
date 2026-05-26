import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import { useAuth } from '../services/auth';
import { ClipCard } from '../components/ClipCard';
import { StakeSheet } from '../components/StakeSheet';
import { priceFromLicenseUrl } from '../domain/licenseCatalog';
import { clipStore, useClips, type Clip } from '../services/clipPipeline';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// COLLECTION タブ — 撮影者が自分のクリップを管理する場所。
//
// SPECS_JA §2.7 のクリップ状態機械を可視化する:
//   • アップロード中 / 処理中 / 準備完了 / 不合格 / 処理エラー はローカル pipeline (= clipPipeline)
//     の発火源 (= 撮影完了時の「送る」 押下)
//   • ステーキング済み はオンチェーン (DAS) からも hydrate される (= 過去にステーキング済みの cNFT)
//
// 両方を 1 つの Clip[] にマージして ClipCard に渡す。 タップして開く Stake シートは「準備完了」
// 状態にのみ作用する (= SPECS §4.2 で UI 上の入口がここに統合された)。

import { SOLANA_RPC_URL } from '../env';

const DAS_URL = SOLANA_RPC_URL;

const LICENSE_COLLECTION_MINT = 'BvhuJiTWDW6n5cSzE4XmzYcwLry7vcstS1U7fD7n9N1b';

function priceFromUri(uri: string | null | undefined): number {
  return priceFromLicenseUrl(uri) ?? 0;
}

function rootMintFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = uri.match(/[?&]root_mint=([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : null;
}

interface OnChainStakedClip {
  rootAssetId: string;
  delegate: string | null;
  ownerEqualsDelegate: boolean;
  createdAtUnix: number | null;
  licenseCount: number;
  revenueUsdc: number;
}

export const CollectionScreen: React.FC = () => {
  const { state } = useAuth();
  const ownerPubkey = state.status === 'authenticated' ? state.session.pubkey : null;
  const pipelineClips = useClips();

  const [onChain, setOnChain] = useState<OnChainStakedClip[] | null>(null);
  const [onChainError, setOnChainError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [stakeTarget, setStakeTarget] = useState<Clip | null>(null);

  const fetchOnChain = useCallback(async () => {
    if (!ownerPubkey) {
      setOnChain([]);
      return;
    }
    setOnChainError(null);
    try {
      const ownedRes = await fetch(DAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'rl-coll-owned', method: 'getAssetsByOwner',
          params: {
            ownerAddress: ownerPubkey.toBase58(),
            page: 1, limit: 100,
            sortBy: { sortBy: 'created', sortDirection: 'desc' },
          },
        }),
      });
      const ownedJson = await ownedRes.json();
      const ownedItems: any[] = ownedJson?.result?.items ?? [];

      const licRes = await fetch(DAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'rl-coll-licenses', method: 'getAssetsByGroup',
          params: {
            groupKey: 'collection',
            groupValue: LICENSE_COLLECTION_MINT,
            page: 1, limit: 1000,
          },
        }),
      });
      const licJson = await licRes.json();
      const licItems: any[] = licJson?.result?.items ?? [];

      const rev = new Map<string, { count: number; usdc: number }>();
      for (const lic of licItems) {
        const uri: string | undefined =
          lic?.content?.json_uri ?? lic?.content?.metadata?.uri ?? lic?.content?.links?.uri;
        const rootMint = rootMintFromUri(uri);
        if (!rootMint) continue;
        const price = priceFromUri(uri);
        const cur = rev.get(rootMint) ?? { count: 0, usdc: 0 };
        cur.count += 1;
        cur.usdc = +(cur.usdc + price).toFixed(2);
        rev.set(rootMint, cur);
      }

      const mapped: OnChainStakedClip[] = ownedItems
        .filter((a) => a?.compression?.compressed === true)
        .map((a) => {
          const owner: string = a?.ownership?.owner ?? '';
          const delegate: string | null = a?.ownership?.delegate ?? null;
          const r = rev.get(String(a.id)) ?? { count: 0, usdc: 0 };
          return {
            rootAssetId: String(a.id),
            delegate,
            ownerEqualsDelegate: !delegate || delegate === owner,
            createdAtUnix: typeof a?.compression?.created_at === 'number' ? a.compression.created_at : null,
            licenseCount: r.count,
            revenueUsdc: r.usdc,
          };
        });

      setOnChain(mapped);
    } catch (e: any) {
      setOnChainError(e?.message ?? String(e));
      setOnChain([]);
    }
  }, [ownerPubkey]);

  useEffect(() => { fetchOnChain(); }, [fetchOnChain]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOnChain();
    setRefreshing(false);
  }, [fetchOnChain]);

  // pipeline clips + on-chain clips を 1 つの Clip[] にマージ
  // ローカル pipeline 内にすでに同じ rootAssetId がある場合は pipeline 側を優先する。
  const mergedClips: Clip[] = useMemo(() => {
    const pipelineAssetIds = new Set(
      pipelineClips.filter((c) => c.rootAssetId).map((c) => c.rootAssetId!),
    );
    const onChainOnly: Clip[] = (onChain ?? [])
      .filter((oc) => !pipelineAssetIds.has(oc.rootAssetId))
      .map((oc) => ({
        id: oc.rootAssetId,
        taskId: '',  // legacy on-chain clip: task association unknown
        state: 'staked' as const,
        createdAt: (oc.createdAtUnix ?? 0) * 1000,
        rootAssetId: oc.rootAssetId,
        delegate: oc.delegate,
        licenseCount: oc.licenseCount,
        revenueUsdc: oc.revenueUsdc,
      }));
    return [...pipelineClips, ...onChainOnly].sort((a, b) => b.createdAt - a.createdAt);
  }, [pipelineClips, onChain]);

  // ヒーロー totals (= 全 staked clip の合算)
  const totals = useMemo(() => {
    let earned = 0;
    let licenses = 0;
    for (const c of mergedClips) {
      if (c.state === 'staked') {
        earned += c.revenueUsdc ?? 0;
        licenses += c.licenseCount ?? 0;
      }
    }
    return { earned: +earned.toFixed(2), licenses, clips: mergedClips.length };
  }, [mergedClips]);

  const spark = useMemo(() => {
    const staked = mergedClips.filter((c) => c.state === 'staked');
    if (staked.length === 0) return null;
    let acc = 0;
    const pts: number[] = [];
    for (const c of [...staked].reverse()) {
      acc += c.revenueUsdc ?? 0;
      pts.push(acc);
    }
    return pts;
  }, [mergedClips]);

  const onOpenStake = useCallback((clip: Clip) => setStakeTarget(clip), []);
  const onRemove = useCallback((clip: Clip) => clipStore.remove(clip.id), []);
  const onRetry = useCallback((clip: Clip) => clipStore.retry(clip.id), []);
  const onCloseStake = useCallback(() => setStakeTarget(null), []);

  const loading = onChain === null;

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={mergedClips}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />
        }
        ListHeaderComponent={
          <Hero
            ownerPubkey={ownerPubkey?.toBase58() ?? null}
            totals={totals}
            spark={spark}
            loading={loading}
          />
        }
        ListEmptyComponent={
          <EmptyState loading={loading} error={onChainError} hasWallet={!!ownerPubkey} />
        }
        renderItem={({ item }) => (
          <ClipCard
            clip={item}
            onOpenStake={onOpenStake}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />

      <StakeSheet
        visible={stakeTarget !== null}
        clip={stakeTarget}
        onClose={onCloseStake}
      />
    </SafeAreaView>
  );
};

// ─── Hero ────────────────────────────────────────────────────────────

const HERO_DECOR = require('../../assets/decor/earnings-stack.png');

const Hero: React.FC<{
  ownerPubkey: string | null;
  totals: { earned: number; licenses: number; clips: number };
  spark: number[] | null;
  loading: boolean;
}> = ({ ownerPubkey, totals, spark, loading }) => {
  const short = ownerPubkey ? `${ownerPubkey.slice(0, 4)}…${ownerPubkey.slice(-4)}` : '—';
  const hasAnyEarnings = spark && spark.length >= 2 && spark[spark.length - 1] > 0;
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <Text style={styles.heroTitle}>Collection</Text>
        <View style={styles.walletPill}>
          <View style={styles.walletDot} />
          <Text style={styles.walletPillText}>{short}</Text>
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroCardLeft}>
          <Text style={styles.heroEyebrow}>LIFETIME EARNINGS</Text>
          <View style={styles.heroNumberRow}>
            <Text style={styles.heroCurrency}>$</Text>
            <Text style={styles.heroNumber}>{loading ? '—' : totals.earned.toFixed(2)}</Text>
            <Text style={styles.heroUnit}>USDC</Text>
          </View>
          {hasAnyEarnings ? (
            <Sparkline points={spark!} width={170} height={36} />
          ) : (
            <View style={{ height: 36 }} />
          )}
        </View>
        <View style={styles.heroDecorWrap}>
          <Image source={HERO_DECOR} style={styles.heroDecor} resizeMode="contain" />
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatTile label="LICENSES SOLD" value={loading ? '—' : String(totals.licenses)} accent />
        <View style={styles.statSep} />
        <StatTile label="CLIPS" value={loading ? '—' : String(totals.clips)} />
      </View>

      <View style={styles.listIntro}>
        <Text style={styles.listIntroLabel}>YOUR CLIPS</Text>
        <Text style={styles.listIntroHint}>
          撮影したクリップはここで状態が見えます。 「準備完了」 のカードをタップするとステーキング画面が開きます。
        </Text>
      </View>
    </View>
  );
};

const StatTile: React.FC<{ label: string; value: string; accent?: boolean }> = ({
  label, value, accent,
}) => (
  <View style={styles.statTile}>
    <Text style={[styles.statValue, accent && { color: colors.emeraldDeep }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const Sparkline: React.FC<{ points: number[]; width: number; height: number }> = ({
  points, width, height,
}) => {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const polyPoints = points
    .map((y, i) => {
      const x = i * stepX;
      const py = height - ((y - min) / span) * height;
      return `${x.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
  const lastX = (points.length - 1) * stepX;
  const lastY = height - ((points[points.length - 1] - min) / span) * height;
  return (
    <Svg width={width} height={height} style={{ marginTop: 6 }}>
      <Polyline
        points={polyPoints}
        fill="none"
        stroke={colors.emerald}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={lastX} cy={lastY} r={3.5} fill={colors.emerald} />
      <Circle cx={lastX} cy={lastY} r={1.4} fill={colors.card} />
    </Svg>
  );
};

// ─── Empty / Error / Loading ─────────────────────────────────────────

const EmptyState: React.FC<{ loading: boolean; error: string | null; hasWallet: boolean }> = ({
  loading, error, hasWallet,
}) => {
  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.ink} />
        <Text style={styles.emptyText}>Loading…</Text>
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
  if (!hasWallet) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEyebrow}>NO WALLET</Text>
        <Text style={styles.emptyText}>
          認証 provider が初期化中、 もしくは未認証です。 設定画面で確認してください。
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Svg width={64} height={64} viewBox="0 0 64 64" fill="none">
        <Path
          d="M16 22l16-9 16 9v20l-16 9-16-9V22z"
          stroke={colors.textFaint}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <Circle cx={32} cy={32} r={4} fill={colors.textFaint} />
      </Svg>
      <Text style={styles.emptyEyebrow}>NO CLIPS YET</Text>
      <Text style={styles.emptyText}>
        Job タブから撮影を始めると、 撮影完了後ここに表示されます。
      </Text>
    </View>
  );
};

// ─── styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.sm },

  hero: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroTitle: {
    fontFamily: fonts.serifSemibold,
    fontSize: 32,
    letterSpacing: -0.5,
    color: colors.ink,
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
  },
  walletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald },
  walletPillText: {
    ...typography.mono,
    fontSize: 11,
    color: colors.textBody,
  },

  heroCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.md,
    overflow: 'hidden',
    ...shadows.card,
  },
  heroCardLeft: { flex: 1, gap: 4, justifyContent: 'center' },
  heroEyebrow: { ...typography.label, color: colors.textMute },
  heroNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
  heroCurrency: {
    fontFamily: fonts.serifLight,
    fontSize: 32, color: colors.ink, lineHeight: 36,
  },
  heroNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 56, color: colors.ink, letterSpacing: -1.5, lineHeight: 60,
  },
  heroUnit: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11, letterSpacing: 1.4, color: colors.textMute,
    marginLeft: 6, marginBottom: 6,
  },
  heroDecorWrap: { width: 110, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  heroDecor: { width: '100%', height: '100%' },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.lg,
    ...shadows.card,
  },
  statTile: { flex: 1, alignItems: 'center', gap: 2 },
  statSep: { width: 1, backgroundColor: colors.border, marginVertical: 4 },
  statValue: {
    fontFamily: fonts.serifMedium,
    fontSize: 28, color: colors.ink, letterSpacing: -0.5,
  },
  statLabel: { ...typography.labelSmall, color: colors.textMute },

  listIntro: { paddingTop: spacing.md, paddingHorizontal: 2, gap: 4 },
  listIntroLabel: { ...typography.label, color: colors.textMute },
  listIntroHint: { ...typography.caption, color: colors.textBody, lineHeight: 19 },

  empty: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyEyebrow: { ...typography.label, color: colors.textMute, marginTop: spacing.sm },
  emptyText: {
    ...typography.body,
    color: colors.textBody,
    textAlign: 'center',
    maxWidth: 280,
  },
});
