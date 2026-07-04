// マイビデオ画面 (v0.1.4) — 撮影者の保有クリップ一覧。
//
// v0.1.4 はラベリング / 採点 / staking / 販売を持たない (= 後段ワーカー未配線)。
// なので「アップロード状況だけのフラット一覧」 + 温かい家事感のあるヘッダ (= 家事フリマ風)。
//
// データはローカル AsyncStorage に積んだクリップを useClips() で読み、 必要に応じて
// サーバの GET /api/clips とマージする (= マージは v0.1.5 で後段が動き始めたら強化)。

import React, { useCallback, useState } from 'react';
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
import Svg, { Circle, Path } from 'react-native-svg';

import { ClipCard } from '../components/ClipCard';
import { storeEventSink, advanceClip, discardClip, type Clip } from '../dataflow';
import { useClips } from '../clips/hooks';
import { useT, type TranslationKey } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';

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
  const clips = useClips();
  const [refreshing, setRefreshing] = useState(false);

  const onRemove = useCallback((clip: Clip) => { void discardClip(clip.id); }, []);
  const onRetry = useCallback((clip: Clip) => { void advanceClip(clip.id, storeEventSink); }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // v0.1.4: サーバ pull は省略 (= ローカルが真実)。
    // 後段ワーカーが動き始めたら GET /api/clips とマージする。
    await new Promise((r) => setTimeout(r, 300));
    setRefreshing(false);
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={clips}
        keyExtractor={(item) => item.id}
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
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.itemWrap}>
            <ClipCard clip={item} onRemove={onRemove} onRetry={onRetry} />
          </View>
        )}
        ListEmptyComponent={<EmptyState />}
      />
    </SafeAreaView>
  );
};

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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.sm },

  header: { gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
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

  itemWrap: { marginBottom: spacing.md },

  empty: { paddingTop: spacing.xxl, paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { ...typography.label, color: colors.textMute, marginTop: spacing.sm },
  emptyHint: { ...typography.body, color: colors.textBody, textAlign: 'center', maxWidth: 280 },
});

// 未使用 import を抑止
void ActivityIndicator;
