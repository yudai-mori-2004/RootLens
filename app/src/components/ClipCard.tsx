import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { Clip } from '../dataflow';
import { clipTitle } from '../domain/clipLabels';
import { useT, getLocale } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// クリップカード。
//
// SPECS_JA §2.7 のクリップ状態機械の各状態を、 1 つのカード type で表示分岐する。
// 各状態に対応する右側の affordance:
//   - アップロード中:  進捗バー + キャンセル
//   - 処理中:          4 ステップの dot progress + 現在のステップ名
//   - 準備完了:        品質スコア + 「Stake」 CTA (= タップで詳細シート)
//   - ステーキング済み: ライセンス数 + 累計売上
//   - 不合格:          不合格理由 + 「削除」 「再試行」
//   - 処理エラー:      エラー文言 + 「再試行」 「削除」
//
// 視覚的階層 (= ユーザの注意を引く強さ):
//   準備完了 > 不合格 ≒ 処理エラー > 処理中 > アップロード中 > ステーキング済み
//
// 準備完了が一番目立つように、 emeraldFaint の地色 + emeraldDeep の枠を採用。
// 他の状態は paper / card の neutral 上で動作するように設計。

interface Props {
  clip: Clip;
  onOpenStake?: (clip: Clip) => void;
  /// ready / staked / error 行のタップで詳細シート (UI_SPECS §3.3 / §3.4) を開く。
  onOpenDetail?: (clip: Clip) => void;
  onRemove?: (clip: Clip) => void;
  onRetry?: (clip: Clip) => void;
  /// 強制ローディング表示 (= Pipeline 2 でスタック中/エラー。 ユーザー操作不可なので「採点中」 と同じ見た目)。
  forceLoading?: boolean;
}

export const ClipCard: React.FC<Props> = ({ clip, onOpenStake, onOpenDetail, onRemove, onRetry, forceLoading }) => {
  // Pipeline 2 stuck (= processing / 登録後 error) はユーザー主導権が無いので常にローディング表示。
  if (forceLoading) return <ProcessingCard clip={clip} onOpenDetail={onOpenDetail} />;
  switch (clip.state) {
    case 'uploading':
      return <UploadingCard clip={clip} onRemove={onRemove} />;
    case 'processing':
      return <ProcessingCard clip={clip} onOpenDetail={onOpenDetail} />;
    case 'ready':
      return <ReadyCard clip={clip} onOpenDetail={onOpenDetail} />;
    case 'staked':
      return <StakedCard clip={clip} onOpenDetail={onOpenDetail} />;
    case 'error':
      return <ErrorCard clip={clip} onOpenDetail={onOpenDetail} onRemove={onRemove} onRetry={onRetry} />;
  }
};

// ─── 共通要素 ──────────────────────────────────────────────────────────

// クリップのサムネ枠。 ぼかし済み preview MP4 (= previewVideoUrl) から実フレームを 1 枚生成して見せる。
// ⚠ 一覧で全動画を毎回 DL すると重い (= 「件数に耐える」 に反する) ので、 (a) previewVideoUrl がある
//    動画だけ生成、 (b) signature_hash でモジュールキャッシュして再生成しない、 (c) 仮想化で可視分だけ。
//    将来はサーバ生成 poster (= previewThumbUrl) に寄せてクライアント生成を無くすのが本筋。
// 未生成/未対応はプレースホルダ (= 再生グリフ)。
const thumbCache = new Map<string, string>();

const ClipThumb: React.FC<{ clip: Clip; muted?: boolean }> = ({ clip, muted }) => {
  const url = clip.previewVideoUrl;
  const key = clip.signatureHash ?? clip.id;
  const [uri, setUri] = useState<string | null>(url ? thumbCache.get(key) ?? null : null);

  useEffect(() => {
    if (!url || thumbCache.has(key)) return;
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(url, { time: 800, quality: 0.5 })
      .then((r) => { thumbCache.set(key, r.uri); if (!cancelled) setUri(r.uri); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [url, key]);

  return (
    <View style={[styles.thumb, muted && styles.thumbMuted]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
      ) : (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Circle cx={11} cy={11} r={10} stroke={colors.textFaint} strokeWidth={1.2} />
          <Polygon points="9,7.5 15,11 9,14.5" fill={colors.textFaint} />
        </Svg>
      )}
    </View>
  );
};

// 動画の「正体」 = AI 要約 or 撮影日時 (= clipTitle)。 hash は出さない。
const ClipName: React.FC<{ clip: Clip }> = ({ clip }) => (
  <Text style={styles.cardName} numberOfLines={2}>
    {clipTitle(clip)}
  </Text>
);

const formatTimestamp = (ts: number): string => {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  const d = new Date(ts);
  const sameDay = isSameDay(d, new Date());
  if (sameDay) {
    return d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(tag, { month: 'short', day: 'numeric' });
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ─── アップロード中 ─────────────────────────────────────────────────────

const UploadingCard: React.FC<{ clip: Clip; onRemove?: (c: Clip) => void }> = ({
  clip, onRemove,
}) => {
  const t = useT();
  const progress = Math.max(0, Math.min(1, clip.uploadProgress ?? 0));
  return (
    <View style={styles.card}>
      <ClipThumb clip={clip} />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <Text style={styles.eyebrowMuted}>{t('clip.uploading')} · {Math.round(progress * 100)}%</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
      <Pressable
        onPress={() => onRemove?.(clip)}
        hitSlop={8}
        style={({ pressed }) => [styles.cornerBtn, pressed && styles.cornerBtnPressed]}
        accessibilityLabel={t('common.cancel')}
      >
        <Svg width={14} height={14} viewBox="0 0 14 14">
          <Line x1={3} y1={3} x2={11} y2={11} stroke={colors.textMute} strokeWidth={1.6} strokeLinecap="round" />
          <Line x1={11} y1={3} x2={3} y2={11} stroke={colors.textMute} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      </Pressable>
    </View>
  );
};

// ─── 処理中 ────────────────────────────────────────────────────────────

// サーバ Pipeline 2 は段数を公開しない (= 単一の scoring ステップ) ので、 進捗率ではなく
// 「進行中」 を示す不確定ローディングバーを出す (= ハイライトがトラックを繰り返し流れる)。
const IndeterminateBar: React.FC = () => {
  const anim = useRef(new Animated.Value(0)).current;
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const segW = Math.max(24, trackW * 0.4);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-segW, trackW] });
  return (
    <View
      style={styles.progressTrack}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
    >
      {trackW > 0 ? (
        <Animated.View style={[styles.indeterminateFill, { width: segW, transform: [{ translateX }] }]} />
      ) : null}
    </View>
  );
};

const ProcessingCard: React.FC<{ clip: Clip; onOpenDetail?: (c: Clip) => void }> = ({ clip, onOpenDetail }) => {
  const t = useT();
  return (
    <Pressable
      onPress={() => onOpenDetail?.(clip)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityLabel={t('clip.viewDetailA11y')}
    >
      <ClipThumb clip={clip} />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <Text style={styles.eyebrowMuted}>{t('clip.processing')}</Text>
        <IndeterminateBar />
      </View>
    </Pressable>
  );
};

// ─── 準備完了 (= action 要請、 視覚最強) ──────────────────────────────

const ReadyCard: React.FC<{ clip: Clip; onOpenDetail?: (c: Clip) => void }> = ({
  clip, onOpenDetail,
}) => {
  const t = useT();
  return (
    <Pressable
      onPress={() => onOpenDetail?.(clip)}
      style={({ pressed }) => [styles.card, styles.cardReady, pressed && styles.cardReadyPressed]}
      accessibilityLabel={t('clip.viewDetailA11y')}
    >
      <ClipThumb clip={clip} />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <View style={styles.cardFoot}>
          <Text style={styles.cardSub}>{formatTimestamp(clip.createdAt)}</Text>
          <View style={styles.cardFootSpacer} />
          <View style={styles.sellChip}>
            <Text style={styles.sellChipLabel}>{t('clip.stakeCta')}</Text>
            <Svg width={12} height={12} viewBox="0 0 12 12">
              <Path d="M3 6h6m-2 -2 2 2 -2 2" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

// ─── ステーキング済み ──────────────────────────────────────────────────

const StakedCard: React.FC<{ clip: Clip; onOpenDetail?: (c: Clip) => void }> = ({
  clip, onOpenDetail,
}) => {
  const t = useT();
  const licenseCount = clip.licenseCount ?? 0;
  const revenue = clip.revenueUsdc ?? 0;
  return (
    <Pressable
      onPress={() => onOpenDetail?.(clip)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityLabel={t('clip.viewDetailA11y')}
    >
      <ClipThumb clip={clip} />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <View style={styles.cardMeta}>
          <View style={[styles.statusChip, styles.statusChipStaked]}>
            <Text style={[styles.statusChipText, { color: colors.emeraldDeep }]}>{t('clip.statusStaked')}</Text>
          </View>
          <Text style={styles.cardSub}>· {formatTimestamp(clip.createdAt)}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <View style={styles.statCol}>
          <Text style={styles.statColValue}>{licenseCount}</Text>
          <Text style={styles.statColLabel}>{t('clip.statLic')}</Text>
        </View>
        <View style={styles.statColSep} />
        <View style={styles.statCol}>
          <Text style={[styles.statColValue, revenue > 0 ? { color: colors.emeraldDeep } : { color: colors.textFaint }]}>
            ${revenue.toFixed(2)}
          </Text>
          <Text style={styles.statColLabel}>{t('clip.statEarned')}</Text>
        </View>
      </View>
    </Pressable>
  );
};

// ─── 処理エラー ────────────────────────────────────────────────────────

const ErrorCard: React.FC<{
  clip: Clip;
  onOpenDetail?: (c: Clip) => void;
  onRemove?: (c: Clip) => void; onRetry?: (c: Clip) => void;
}> = ({ clip, onOpenDetail, onRemove, onRetry }) => {
  const t = useT();
  return (
    <Pressable
      onPress={() => onOpenDetail?.(clip)}
      style={({ pressed }) => [styles.card, styles.cardMuted, pressed && styles.cardPressed]}
      accessibilityLabel={t('clip.viewErrorA11y')}
    >
      <ClipThumb clip={clip} muted />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <Text style={styles.eyebrowDanger}>{t('clip.errorEyebrow')}</Text>
        <Text style={styles.cardSub} numberOfLines={2}>
          {clip.errorMessage ?? t('clip.errorDefault')}
        </Text>
        <View style={styles.actionRow}>
          <SmallActionBtn label={t('common.delete')} onPress={() => onRemove?.(clip)} />
          {/* 再試行は Pipeline 1 段の失敗のみ (= 登録済み以降の Pipeline 2 はサーバ側で再投入、 ユーザー再試行はしない) */}
          {clip.stage !== 'registered' ? (
            <SmallActionBtn label={t('clip.tryAgain')} onPress={() => onRetry?.(clip)} accent />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

const SmallActionBtn: React.FC<{ label: string; onPress: () => void; accent?: boolean }> = ({
  label, onPress, accent,
}) => (
  <Pressable
    onPress={onPress}
    hitSlop={6}
    style={({ pressed }) => [
      styles.smallBtn,
      accent && styles.smallBtnAccent,
      pressed && styles.smallBtnPressed,
    ]}
  >
    <Text style={[styles.smallBtnLabel, accent && styles.smallBtnLabelAccent]}>{label}</Text>
  </Pressable>
);

// ─── styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardPressed: { backgroundColor: colors.paperDeep },
  cardMuted: { backgroundColor: colors.paperDeep },

  // 出品可能カード: 緑で埋めず、 白ベース + エメラルドのヘアライン枠で上品に差別化。
  cardReady: {
    borderColor: colors.borderEmerald,
  },
  cardReadyPressed: {
    backgroundColor: colors.paperDeep,
  },

  thumb: {
    width: 88,
    aspectRatio: 1,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumbMuted: { opacity: 0.55 },
  thumbImage: { width: '100%', height: '100%' },
  thumbFallback: { ...typography.label, color: colors.textMute },

  cardMid: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    gap: 4,
  },
  cardName: {
    fontFamily: fonts.sansSemibold,
    fontSize: 16,
    lineHeight: 21,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  // 出品カードのフッタ行 (= 日時 + 出品 chip を下段に逃がしてタイトルを全幅にする)
  cardFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: spacing.sm },
  cardFootSpacer: { flex: 1 },
  sellChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: colors.emerald, borderRadius: radii.full,
  },
  sellChipLabel: { fontFamily: fonts.sansSemibold, fontSize: 12, letterSpacing: 0.6, color: '#fff' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  cardSub: { ...typography.caption, color: colors.textMute },

  eyebrowMuted: {
    ...typography.labelSmall,
    color: colors.textMute,
    marginTop: 2,
  },
  eyebrowEmerald: {
    ...typography.labelSmall,
    color: colors.emeraldDeep,
    marginTop: 2,
  },
  eyebrowWarn: {
    ...typography.labelSmall,
    color: colors.warn,
    marginTop: 2,
  },
  eyebrowDanger: {
    ...typography.labelSmall,
    color: colors.danger,
    marginTop: 2,
  },

  // status chip (staked)
  statusChip: {
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radii.sm, borderWidth: 1,
  },
  statusChipStaked: { backgroundColor: colors.emeraldSoft, borderColor: colors.borderEmerald },
  statusChipText: { ...typography.labelSmall },

  // staked right column
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
  statCol: { alignItems: 'center', minWidth: 50, gap: 2 },
  statColSep: { width: 1, height: 30, backgroundColor: colors.border },
  statColValue: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  statColLabel: { ...typography.labelSmall, color: colors.textMute },

  // upload progress
  progressTrack: {
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.emerald,
    borderRadius: 2,
  },
  // 不確定ローディング (= 処理中。 ハイライトがトラックを繰り返し流れる)
  indeterminateFill: {
    height: 4,
    backgroundColor: colors.emerald,
    borderRadius: 2,
  },

  // corner cancel
  cornerBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
    backgroundColor: colors.paperDeep,
    borderWidth: 1, borderColor: colors.border,
  },
  cornerBtnPressed: { backgroundColor: colors.borderLight },

  // ready: stake CTA pill
  stakeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.ink,
    borderRadius: radii.full,
    marginRight: spacing.md,
  },
  stakeCtaLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12, letterSpacing: 0.6,
    color: '#fff',
  },

  // small text-button actions (rejected / error)
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 8,
  },
  smallBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  smallBtnPressed: { backgroundColor: colors.paperDeep },
  smallBtnAccent: { backgroundColor: colors.ink, borderColor: colors.ink },
  smallBtnLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textBody,
  },
  smallBtnLabelAccent: { color: '#fff' },
});

// Suppress unused warning for shadows / typography re-export shape
void Circle;
