// Portfolio タブ — 撮影者が自分のクリップ (= 収益を生む保有データ資産) を管理する場所。
//
// 構成:
//   • ヒーローカード (PortfolioHero): 時計/$ トグルで 撮影時間 と 収益 を可視化
//   • セクション (折りたたみ可): 採点待ち / 採点済み・承認待ち / 販売中
//
// データは usePortfolioData がサーバ GET /api/clips + ローカル store + オンチェーンをマージして供給する。
// 一覧は SectionList で仮想化し、 件数が増えても耐える。

import React, { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  SafeAreaView,
  SectionList,
  StyleSheet,
  Text,
  View,
  Image,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { ClipCard } from '../components/ClipCard';
import { StakeSheet } from '../components/StakeSheet';
import { ClipDetailSheet } from '../components/ClipDetailSheet';
import { storeEventSink, advanceClip, discardClip, type Clip } from '../dataflow';
import { useT, type TranslationKey } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';
import { usePortfolioData } from './portfolio/usePortfolioData';
import { PortfolioHero } from './portfolio/PortfolioHero';

// Pipeline 2 でスタック中 (= processing / 登録後 error) か。 ユーザー操作不可 → ローディング表示。
const isP2Stuck = (c: Clip) => c.state === 'processing' || (c.state === 'error' && c.stage === 'registered');

interface SectionDef {
  key: 'awaiting' | 'approval' | 'onSale';
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  data: Clip[];
}

// 時間帯であいさつを選ぶ (= 家事感・温かさ。 5時前/深夜は「おつかれさま」)。
function greetingKeyForNow(): TranslationKey {
  const h = new Date().getHours();
  if (h < 5) return 'portfolio.greetingNight';
  if (h < 11) return 'portfolio.greetingMorning';
  if (h < 17) return 'portfolio.greetingDay';
  if (h < 23) return 'portfolio.greetingEvening';
  return 'portfolio.greetingNight';
}

export const CollectionScreen: React.FC = () => {
  const t = useT();
  const { metrics, groups, loading, refreshing, onRefresh } = usePortfolioData();

  const [stakeTarget, setStakeTarget] = useState<Clip | null>(null);
  const [detailTarget, setDetailTarget] = useState<Clip | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const onOpenDetail = useCallback((clip: Clip) => setDetailTarget(clip), []);
  const onOpenStake = useCallback((clip: Clip) => setStakeTarget(clip), []);
  const onRemove = useCallback((clip: Clip) => { void discardClip(clip.id); }, []);
  const onRetry = useCallback((clip: Clip) => { void advanceClip(clip.id, storeEventSink); }, []);
  const onCloseStake = useCallback(() => { setStakeTarget(null); void onRefresh(); }, [onRefresh]);
  const onCloseDetail = useCallback(() => setDetailTarget(null), []);
  const toggle = useCallback((key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] })), []);

  const sections = useMemo(() => {
    const defs: SectionDef[] = [
      { key: 'awaiting', titleKey: 'portfolio.sectionAwaiting', hintKey: 'portfolio.sectionAwaitingHint', data: groups.awaitingScoring },
      { key: 'approval', titleKey: 'portfolio.sectionApproval', hintKey: 'portfolio.sectionApprovalHint', data: groups.readyForApproval },
      { key: 'onSale', titleKey: 'portfolio.sectionOnSale', hintKey: 'portfolio.sectionOnSaleHint', data: groups.onSale },
    ];
    return defs
      .filter((d) => d.data.length > 0)
      .map((d) => ({ ...d, count: d.data.length, data: collapsed[d.key] ? [] : d.data }));
  }, [groups, collapsed]);

  return (
    <SafeAreaView style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}
        initialNumToRender={8}
        windowSize={11}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.banner}>
              <Image
                source={require('../../assets/decor/home-banner.png')}
                style={styles.bannerImg}
                resizeMode="cover"
              />
              <View style={styles.bannerText}>
                <Text style={styles.greeting}>{t(greetingKeyForNow())}</Text>
                <Text style={styles.greetingSub}>{t('portfolio.greetingSub')}</Text>
              </View>
            </View>
            <PortfolioHero metrics={metrics} loading={loading} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <SectionHeader
            title={t(section.titleKey)}
            hint={t(section.hintKey)}
            count={section.count}
            collapsed={!!collapsed[section.key]}
            onPress={() => toggle(section.key)}
          />
        )}
        renderItem={({ item, section }) => (
          <View style={styles.itemWrap}>
            <ClipCard
              clip={item}
              onOpenStake={onOpenStake}
              onOpenDetail={onOpenDetail}
              onRemove={onRemove}
              onRetry={onRetry}
              forceLoading={section.key === 'awaiting' && isP2Stuck(item)}
            />
          </View>
        )}
        ListEmptyComponent={loading ? null : <EmptyState />}
      />

      <ClipDetailSheet
        visible={detailTarget !== null}
        clip={detailTarget}
        onClose={onCloseDetail}
        onOpenStake={onOpenStake}
        onRemove={onRemove}
      />
      <StakeSheet visible={stakeTarget !== null} clip={stakeTarget} onClose={onCloseStake} />
    </SafeAreaView>
  );
};

// ─── セクションヘッダ (= 折りたたみトグル) ──────────────────────────────
const SectionHeader: React.FC<{
  title: string; hint: string; count: number; collapsed: boolean; onPress: () => void;
}> = ({ title, hint, count, collapsed, onPress }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}>
    <View style={styles.sectionHeaderTop}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCountPill}>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <View style={styles.sectionHeaderSpacer} />
      <Chevron collapsed={collapsed} />
    </View>
    {!collapsed ? <Text style={styles.sectionHint}>{hint}</Text> : null}
  </Pressable>
);

const Chevron: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    <Path
      d={collapsed ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'}
      stroke={colors.textMute}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// ─── 空状態 ──────────────────────────────────────────────────────────
const EmptyState: React.FC = () => {
  const t = useT();
  return (
    <View style={styles.empty}>
      <Svg width={56} height={56} viewBox="0 0 64 64" fill="none">
        <Path d="M16 22l16-9 16 9v20l-16 9-16-9V22z" stroke={colors.textFaint} strokeWidth={1.6} strokeLinejoin="round" />
        <Circle cx={32} cy={32} r={4} fill={colors.textFaint} />
      </Svg>
      <Text style={styles.emptyTitle}>{t('portfolio.emptyTitle')}</Text>
      <Text style={styles.emptyHint}>{t('portfolio.emptyHint')}</Text>
    </View>
  );
};

// ─── styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.sm },

  header: { gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  banner: {
    height: 172,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: '#F6E9C6',
  },
  bannerImg: { width: '100%', height: '100%' },
  bannerText: { position: 'absolute', top: spacing.lg, left: spacing.lg, right: '42%', gap: 2 },
  greeting: { fontFamily: fonts.serifMedium, fontSize: 28, letterSpacing: -0.4, color: colors.ink },
  greetingSub: { ...typography.caption, color: colors.inkMute, lineHeight: 18 },

  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: 4 },
  sectionHeaderPressed: { opacity: 0.6 },
  sectionHeaderTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.ink },
  sectionCountPill: {
    minWidth: 20, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: radii.full, backgroundColor: colors.paperDeep, alignItems: 'center',
  },
  sectionCount: { ...typography.labelSmall, color: colors.textMute },
  sectionHeaderSpacer: { flex: 1 },
  sectionHint: { ...typography.caption, color: colors.textMute },

  itemWrap: { marginBottom: spacing.md },

  empty: { paddingTop: spacing.xxl, paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { ...typography.label, color: colors.textMute, marginTop: spacing.sm },
  emptyHint: { ...typography.body, color: colors.textBody, textAlign: 'center', maxWidth: 280 },
});
