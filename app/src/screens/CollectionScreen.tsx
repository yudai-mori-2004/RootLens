// マイビデオ画面 (v0.1.4) — 撮影済み・アップロード待ちクリップの一覧。
//
// 役割: 「撮影されて、 まだアップロードされていない」 データが並ぶ。 カードタップで
// プレビューポップ (= ClipPreviewModal) が開き、 中身に問題がないことを確認して
// 「アップロードする」 を押す。 アップロードが完了したカードは一覧から消える。
//
// 横持ち (landscape) 前提: 2 カラムのカードグリッド + コンパクトな温かいヘッダ。
// データはローカル dataflow store が真実 (= uploaded はサーバへ引き渡し済みなので表示しない)。

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { ClipCard } from '../components/ClipCard';
import { ClipPreviewModal } from '../components/ClipPreviewModal';
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
  const allClips = useClips();
  // アップロード完了 (= uploaded) は一覧に出さない。 それ以外 (recorded / uploading / error) が並ぶ。
  const clips = useMemo(() => allClips.filter((c) => c.state !== 'uploaded'), [allClips]);

  const [previewTarget, setPreviewTarget] = useState<Clip | null>(null);

  const onOpen = useCallback((clip: Clip) => setPreviewTarget(clip), []);
  const onClose = useCallback(() => setPreviewTarget(null), []);
  const onUpload = useCallback((clip: Clip) => {
    setPreviewTarget(null);
    // 署名 → R2 → 登録。 進捗は一覧のカード (uploading) に出て、 uploaded で消える。
    void advanceClip(clip.id, storeEventSink);
  }, []);
  const onRemove = useCallback((clip: Clip) => {
    setPreviewTarget(null);
    void discardClip(clip.id);
  }, []);
  const onRetry = useCallback((clip: Clip) => { void advanceClip(clip.id, storeEventSink); }, []);

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={clips}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
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
            <ClipCard clip={item} onOpen={onOpen} onRemove={onRemove} onRetry={onRetry} />
          </View>
        )}
        ListEmptyComponent={<EmptyState />}
      />

      <ClipPreviewModal
        visible={previewTarget !== null}
        clip={previewTarget}
        onClose={onClose}
        onUpload={onUpload}
        onRemove={onRemove}
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
  column: { gap: spacing.md },

  // 横持ち: バナーは低め (= 縦スペースを食わない)。 温かさは画像 + あいさつで維持。
  header: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  banner: {
    height: 96,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: '#F6E9C6',
  },
  bannerImg: { width: '100%', height: '100%' },
  bannerText: {
    position: 'absolute',
    top: 0, bottom: 0,
    left: spacing.lg,
    justifyContent: 'center',
    right: '50%',
    gap: 2,
  },
  greeting: { fontFamily: fonts.serifMedium, fontSize: 22, letterSpacing: -0.4, color: colors.ink },
  greetingSub: { ...typography.caption, color: colors.inkMute },

  itemWrap: { flex: 1, marginBottom: spacing.md },

  empty: { paddingTop: spacing.xxl, paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { ...typography.label, color: colors.textMute, marginTop: spacing.sm },
  emptyHint: { ...typography.body, color: colors.textBody, textAlign: 'center', maxWidth: 380 },
});
