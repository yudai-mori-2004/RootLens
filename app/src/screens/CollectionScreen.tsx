// マイビデオ画面 (v0.1.4) — 撮影済み・アップロード待ちクリップの一覧。
//
// 横持ち前提の「誌面」 レイアウト:
//   左 = 固定の情報カラム (あいさつ / 日付 / 待ち本数のヒーロー数字)
//   右 = 写真主体のカードグリッド (2 カラム、 スクロール)
//
// カードタップでプレビューポップ (= ClipPreviewModal)。 uploaded は一覧から消える。

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClipCard, type DesignMock } from '../components/ClipCard';
import { ClipPreviewModal } from '../components/ClipPreviewModal';
import { storeEventSink, advanceClip, discardClip, type Clip } from '../dataflow';
import { useClips } from '../clips/hooks';
import { useT, getLocale, type TranslationKey } from '../i18n';
import { colors, fonts, spacing, typography } from '../theme';

// ─── デザイン検証用モック (= __DEV__ のみ。 store / 永続化を汚さず表示だけ) ──
// 全状態のカードを一覧に並べてデザインを確認する。 コミット時は false にしておく。
const DESIGN_PREVIEW = __DEV__ && false;

const MOCKS: DesignMock[] = DESIGN_PREVIEW
  ? [
      {
        clip: {
          id: 'mock_1', state: 'recorded', createdAt: Date.now() - 8 * 60_000,
          recordingConfigId: 'ultra_wide', durationMs: 754_000,
        },
        thumb: require('../../assets/decor/home-warm.png'),
      },
      {
        clip: {
          id: 'mock_5', state: 'error', createdAt: Date.now() - 50 * 60_000,
          recordingConfigId: 'arkit', durationMs: 233_000,
          errorMessage: 'アップロードに失敗しました。電波の良いところでもう一度お試しください。',
        },
        thumb: require('../../assets/decor/home-banner.png'),
      },
      {
        clip: {
          id: 'mock_3', state: 'uploading', createdAt: Date.now() - 3 * 60_000,
          recordingConfigId: 'ultra_wide', durationMs: 361_000, uploadProgress: 0.62,
        },
        thumb: require('../../assets/decor/celebration.png'),
      },
      {
        clip: {
          id: 'mock_4', state: 'uploading', createdAt: Date.now() - 2 * 60_000,
          recordingConfigId: 'ultra_wide', durationMs: 45_000, uploadProgress: 0,
        },
        thumb: require('../../assets/decor/earnings-stack.png'),
      },
      {
        clip: {
          id: 'mock_2', state: 'recorded', createdAt: Date.now() - 26 * 3600_000,
          recordingConfigId: 'arkit', durationMs: 128_000,
        },
        thumb: require('../../assets/decor/step-storage.png'),
      },
      {
        clip: {
          id: 'mock_6', state: 'recorded', createdAt: Date.now() - 3 * 86400_000,
          recordingConfigId: 'ultra_wide', durationMs: 1_930_000,
        },
      },
    ]
  : [];

function greetingKeyForNow(): TranslationKey {
  const h = new Date().getHours();
  if (h < 5) return 'portfolio.greetingNight';
  if (h < 11) return 'portfolio.greetingMorning';
  if (h < 17) return 'portfolio.greetingDay';
  if (h < 23) return 'portfolio.greetingEvening';
  return 'portfolio.greetingNight';
}

function todayLabel(): string {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  return new Date().toLocaleDateString(tag, { month: 'long', day: 'numeric', weekday: 'long' });
}

interface Row {
  clip: Clip;
  thumb?: DesignMock['thumb'];
}

export const CollectionScreen: React.FC = () => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const allClips = useClips();

  // アップロード完了 (= uploaded) は一覧に出さない。 recorded / uploading / error が並ぶ。
  const rows = useMemo<Row[]>(() => {
    const real: Row[] = allClips
      .filter((c) => c.state !== 'uploaded')
      .map((c) => ({ clip: c }));
    return [...real, ...MOCKS.map((m) => ({ clip: m.clip as Clip, thumb: m.thumb }))];
  }, [allClips]);

  const waiting = rows.length;

  const [previewTarget, setPreviewTarget] = useState<Clip | null>(null);
  const onOpen = useCallback((clip: Clip) => setPreviewTarget(clip), []);
  const onClose = useCallback(() => setPreviewTarget(null), []);
  const onUpload = useCallback((clip: Clip) => {
    setPreviewTarget(null);
    void advanceClip(clip.id, storeEventSink);
  }, []);
  const onRemove = useCallback((clip: Clip) => {
    setPreviewTarget(null);
    void discardClip(clip.id);
  }, []);
  const onRetry = useCallback((clip: Clip) => { void advanceClip(clip.id, storeEventSink); }, []);

  return (
    <View style={[styles.root, { paddingLeft: insets.left }]}>
      {/* ── 左: 情報カラム (= 誌面の扉) ── */}
      <View style={styles.aside}>
        <View>
          <Text style={styles.date}>{todayLabel()}</Text>
          <Text style={styles.greeting}>{t(greetingKeyForNow())}</Text>
          <Text style={styles.greetingSub}>{t('portfolio.greetingSub')}</Text>
        </View>

        <View style={styles.counter}>
          <Text style={styles.counterNumber}>{waiting}</Text>
          <Text style={styles.counterLabel}>{t('clip.recorded')}</Text>
        </View>
      </View>

      {/* ── 右: カードグリッド ── */}
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.clip.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={11}
          renderItem={({ item }) => (
            <View style={styles.itemWrap}>
              <ClipCard
                clip={item.clip}
                previewSource={item.thumb}
                onOpen={onOpen}
                onRemove={onRemove}
                onRetry={onRetry}
              />
            </View>
          )}
        />
      )}

      <ClipPreviewModal
        visible={previewTarget !== null}
        clip={previewTarget}
        onClose={onClose}
        onUpload={onUpload}
        onRemove={onRemove}
      />
    </View>
  );
};

const EmptyState: React.FC = () => {
  const t = useT();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{t('portfolio.emptyTitle')}</Text>
      <Text style={styles.emptyHint}>{t('portfolio.emptyHint')}</Text>
    </View>
  );
};

const ASIDE_WIDTH = 236;

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.paper },

  aside: {
    width: ASIDE_WIDTH,
    paddingLeft: spacing.xl,
    paddingRight: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    justifyContent: 'space-between',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  date: {
    ...typography.labelSmall,
    color: colors.textMute,
    marginBottom: spacing.md,
  },
  greeting: {
    fontFamily: fonts.serifLight,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  greetingSub: {
    ...typography.caption,
    color: colors.textMute,
    marginTop: spacing.sm,
    lineHeight: 19,
  },

  counter: {
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  counterNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 72,
    lineHeight: 76,
    letterSpacing: -2,
    color: colors.ink,
  },
  counterLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
  },

  list: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  column: { gap: spacing.lg },
  itemWrap: { flex: 1, marginBottom: spacing.lg },

  empty: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  emptyTitle: {
    fontFamily: fonts.serifLight,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.4,
    color: colors.textMute,
  },
  emptyHint: {
    ...typography.body,
    color: colors.textBody,
    maxWidth: 420,
  },
});
