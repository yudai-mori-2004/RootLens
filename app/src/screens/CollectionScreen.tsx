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
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import { getDemoWalletPubkey } from '../domain/wallet';
import { TASKS, type TaskDef } from '../domain/taskCatalog';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// COLLECTION タブ — 完全 on-chain real data。
//
//   • supplier wallet の Root NFT (cNFT) を DAS getAssetsByOwner で列挙
//   • License Collection 配下の全 License NFT を DAS getAssetsByGroup で取得
//   • License NFT の content.json_uri から `?root_mint=<asset_id>` を parse
//   • root_asset_id ごとに license 数 + 単価で売上集計
//
// 単価は license URL 内の terms slug から判定:
//   commercial-v1 → $1.00 USDC (price は License NFT 発行時 program に渡された値)
//   training-only-v1 → $0.50 USDC
//
// price の真値を取りたい場合は将来 License NFT のオンチェーン event / Memo を
// 引くべきだが、現状 catalog 固定値 = on-chain で支払われた値なのでこれで一致する。

const ENV = process.env as Record<string, string | undefined>;
const DAS_URL =
  ENV.EXPO_PUBLIC_DAS_URL ?? ENV.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

// 固定の on-chain config (config PDA から読める値を hardcode)。devnet 固定。
const LICENSE_COLLECTION_MINT = 'BvhuJiTWDW6n5cSzE4XmzYcwLry7vcstS1U7fD7n9N1b';

// License URL → price (USDC)。default catalog と同期させる。
const LICENSE_PRICE_BY_SLUG: Record<string, number> = {
  'commercial-v1': 1.0,
  'training-only-v1': 0.5,
};

function priceFromUri(uri: string | null | undefined): number {
  if (!uri) return 0;
  const m = uri.match(/\/licenses\/([^/]+)\//);
  if (!m) return 0;
  return LICENSE_PRICE_BY_SLUG[m[1]] ?? 0;
}

function rootMintFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = uri.match(/[?&]root_mint=([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : null;
}

interface OwnedAsset {
  id: string;
  delegate: string | null;
  ownerEqualsDelegate: boolean;
  createdAtUnix: number | null;
}

interface PerClipRevenue {
  licenseCount: number;
  revenueUsdc: number;
}

// ---- screen -----------------------------------------------------------

export const CollectionScreen: React.FC = () => {
  const ownerPubkey = useMemo(() => getDemoWalletPubkey(), []);
  const [items, setItems] = useState<OwnedAsset[] | null>(null);
  // root_asset_id → { count, revenue }
  const [revenue, setRevenue] = useState<Map<string, PerClipRevenue>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!ownerPubkey) {
      setItems([]);
      return;
    }
    setError(null);
    try {
      // 1) Supplier の Root NFT (cNFT) 列挙
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
      const mapped: OwnedAsset[] = ownedItems
        .filter((a) => a?.compression?.compressed === true)
        .map((a) => {
          const owner = a?.ownership?.owner ?? '';
          const delegate = a?.ownership?.delegate ?? null;
          return {
            id: String(a.id),
            delegate,
            ownerEqualsDelegate: !delegate || delegate === owner,
            createdAtUnix:
              typeof a?.compression?.created_at === 'number'
                ? a.compression.created_at
                : null,
          };
        });
      setItems(mapped);

      // 2) License Collection 配下の全 License NFT を集計 → root_mint で grouping
      // getAssetsByGroup は page 制で limit max 1000。Devnet で license 数は当面少数なので 1 page 固定。
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

      const agg = new Map<string, PerClipRevenue>();
      for (const lic of licItems) {
        const uri: string | undefined =
          lic?.content?.json_uri ?? lic?.content?.metadata?.uri ?? lic?.content?.links?.uri;
        const rootMint = rootMintFromUri(uri);
        if (!rootMint) continue;
        const price = priceFromUri(uri);
        const cur = agg.get(rootMint) ?? { licenseCount: 0, revenueUsdc: 0 };
        cur.licenseCount += 1;
        cur.revenueUsdc = +(cur.revenueUsdc + price).toFixed(2);
        agg.set(rootMint, cur);
      }
      setRevenue(agg);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setItems([]);
    }
  }, [ownerPubkey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  // 集計 (real)
  const totals = useMemo(() => {
    if (!items || items.length === 0) {
      return { earned: 0, licenses: 0, clips: 0 };
    }
    let earned = 0;
    let licenses = 0;
    for (const a of items) {
      const r = revenue.get(a.id);
      if (r) {
        earned += r.revenueUsdc;
        licenses += r.licenseCount;
      }
    }
    return { earned: +earned.toFixed(2), licenses, clips: items.length };
  }, [items, revenue]);

  // sparkline (cumulative real earnings over clip chronology)
  const spark = useMemo(() => {
    if (!items || items.length === 0) return null;
    let acc = 0;
    const pts: number[] = [];
    for (const a of [...items].reverse()) {
      const r = revenue.get(a.id);
      acc += r?.revenueUsdc ?? 0;
      pts.push(acc);
    }
    return pts;
  }, [items, revenue]);

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={items ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />
        }
        ListHeaderComponent={
          <Hero
            ownerPubkey={ownerPubkey?.toBase58() ?? null}
            totals={totals}
            spark={spark}
            loading={items === null}
          />
        }
        ListEmptyComponent={
          <EmptyState loading={items === null} error={error} hasWallet={!!ownerPubkey} />
        }
        renderItem={({ item }) => (
          <ClipCard
            asset={item}
            rev={revenue.get(item.id) ?? null}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
    </SafeAreaView>
  );
};

// ---- Hero --------------------------------------------------------------

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
            <Text style={styles.heroNumber}>
              {loading ? '—' : totals.earned.toFixed(2)}
            </Text>
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
        <StatTile label="CLIPS OWNED" value={loading ? '—' : String(totals.clips)} />
      </View>

      <View style={styles.listIntro}>
        <Text style={styles.listIntroLabel}>YOUR CLIPS</Text>
        <Text style={styles.listIntroHint}>
          On-chain license sales attribute to each clip in real time. Pull to refresh.
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

// ---- Clip Card --------------------------------------------------------

const ClipCard: React.FC<{ asset: OwnedAsset; rev: PerClipRevenue | null }> = ({ asset, rev }) => {
  const licenseCount = rev?.licenseCount ?? 0;
  const revenue = rev?.revenueUsdc ?? 0;
  const open = () =>
    Linking.openURL(`https://solscan.io/token/${asset.id}?cluster=devnet`).catch(() => {});
  const recorded = useMemo(() => {
    if (!asset.createdAtUnix) return null;
    const d = new Date(asset.createdAtUnix * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, [asset.createdAtUnix]);

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.thumb}>
        <Text style={styles.thumbFallback}>cNFT</Text>
      </View>

      <View style={styles.cardMid}>
        <Text style={styles.cardName} numberOfLines={1}>
          {`Clip ${asset.id.slice(0, 4)}…${asset.id.slice(-4)}`}
        </Text>
        <View style={styles.cardMeta}>
          <View
            style={[
              styles.statusChip,
              asset.ownerEqualsDelegate ? styles.statusChipUnstaked : styles.statusChipStaked,
            ]}
          >
            <Text
              style={[
                styles.statusChipText,
                {
                  color: asset.ownerEqualsDelegate ? colors.textMute : colors.emeraldDeep,
                },
              ]}
            >
              {asset.ownerEqualsDelegate ? 'NOT STAKED' : 'STAKED'}
            </Text>
          </View>
          {recorded ? <Text style={styles.cardSub}>· {recorded}</Text> : null}
        </View>
      </View>

      <View style={styles.cardRight}>
        <View style={styles.statCol}>
          <Text style={styles.statColValue}>{licenseCount}</Text>
          <Text style={styles.statColLabel}>LIC</Text>
        </View>
        <View style={styles.statColSep} />
        <View style={styles.statCol}>
          <Text style={[
            styles.statColValue,
            revenue > 0 ? { color: colors.emeraldDeep } : { color: colors.textFaint },
          ]}>
            ${revenue.toFixed(2)}
          </Text>
          <Text style={styles.statColLabel}>EARNED</Text>
        </View>
      </View>
    </Pressable>
  );
};

// ---- Empty / Error / Loading ------------------------------------------

const EmptyState: React.FC<{ loading: boolean; error: string | null; hasWallet: boolean }> = ({
  loading, error, hasWallet,
}) => {
  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.ink} />
        <Text style={styles.emptyText}>Loading from DAS…</Text>
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
          Set EXPO_PUBLIC_DEMO_WALLET_ADDRESS in .env, then reload.
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
        Pick a job to record your first clip. It will start earning here.
      </Text>
    </View>
  );
};

// ---- Styles ------------------------------------------------------------

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
  walletDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald,
  },
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
  heroEyebrow: {
    ...typography.label,
    color: colors.textMute,
  },
  heroNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 4,
  },
  heroCurrency: {
    fontFamily: fonts.serifLight,
    fontSize: 32,
    color: colors.ink,
    lineHeight: 36,
  },
  heroNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 56,
    color: colors.ink,
    letterSpacing: -1.5,
    lineHeight: 60,
  },
  heroUnit: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.textMute,
    marginLeft: 6,
    marginBottom: 6,
  },
  heroDecorWrap: {
    width: 110,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDecor: { width: '100%', height: '100%' },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    ...shadows.card,
  },
  statTile: { flex: 1, alignItems: 'center', gap: 2 },
  statSep: { width: 1, backgroundColor: colors.border, marginVertical: 4 },
  statValue: {
    fontFamily: fonts.serifMedium,
    fontSize: 28,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  statLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
  },

  listIntro: {
    paddingTop: spacing.md,
    paddingHorizontal: 2,
    gap: 4,
  },
  listIntroLabel: {
    ...typography.label,
    color: colors.textMute,
  },
  listIntroHint: {
    ...typography.caption,
    color: colors.textBody,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardPressed: { backgroundColor: colors.paperDeep },

  thumb: {
    width: 76,
    aspectRatio: 1,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbFallback: {
    ...typography.label,
    color: colors.textMute,
  },

  cardMid: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    gap: 4,
  },
  cardName: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.ink,
    letterSpacing: 0,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  cardSub: { ...typography.caption, color: colors.textFaint },

  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingRight: spacing.lg,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    gap: spacing.md,
  },
  statCol: { alignItems: 'center', minWidth: 56, gap: 2 },
  statColSep: { width: 1, height: 30, backgroundColor: colors.border },
  statColValue: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  statColLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
  },

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
