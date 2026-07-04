import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import type { Clip } from '../dataflow';
import { clipTitle } from '../domain/clipLabels';
import { useT, getLocale } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// v0.1.4 クリップカード。 3 状態のみ:
//   uploading: 進捗バー + キャンセル
//   uploaded:  「アップロード済み」 + 日時
//   error:     エラー文言 + 「再試行」 「削除」

interface Props {
  clip: Clip;
  onRemove?: (clip: Clip) => void;
  onRetry?: (clip: Clip) => void;
}

export const ClipCard: React.FC<Props> = ({ clip, onRemove, onRetry }) => {
  switch (clip.state) {
    case 'uploading':
      return <UploadingCard clip={clip} onRemove={onRemove} />;
    case 'uploaded':
      return <UploadedCard clip={clip} />;
    case 'error':
      return <ErrorCard clip={clip} onRemove={onRemove} onRetry={onRetry} />;
  }
};

// ─── 共通要素 ──────────────────────────────────────────────────────────

const ClipThumb: React.FC<{ muted?: boolean }> = ({ muted }) => (
  <View style={[styles.thumb, muted && styles.thumbMuted]}>
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Circle cx={11} cy={11} r={10} stroke={colors.textFaint} strokeWidth={1.2} />
      <Polygon points="9,7.5 15,11 9,14.5" fill={colors.textFaint} />
    </Svg>
  </View>
);

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
      <ClipThumb />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <Text style={styles.eyebrowMuted}>{t('clip.uploading')} · {Math.round(progress * 100)}%</Text>
        <IndeterminateOrFill progress={progress} />
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

const IndeterminateOrFill: React.FC<{ progress: number }> = ({ progress }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    if (progress > 0) return;
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
  }, [anim, progress]);
  if (progress > 0) {
    return (
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    );
  }
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

// ─── アップロード済み ──────────────────────────────────────────────────

const UploadedCard: React.FC<{ clip: Clip }> = ({ clip }) => {
  const t = useT();
  return (
    <View style={styles.card}>
      <ClipThumb />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <View style={styles.cardFoot}>
          <Text style={styles.eyebrowEmerald}>{t('clip.uploaded')}</Text>
          <Text style={styles.cardSub}>· {formatTimestamp(clip.createdAt)}</Text>
        </View>
      </View>
    </View>
  );
};

// ─── エラー ────────────────────────────────────────────────────────────

const ErrorCard: React.FC<{
  clip: Clip;
  onRemove?: (c: Clip) => void; onRetry?: (c: Clip) => void;
}> = ({ clip, onRemove, onRetry }) => {
  const t = useT();
  return (
    <View style={[styles.card, styles.cardMuted]}>
      <ClipThumb muted />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <Text style={styles.eyebrowDanger}>{t('clip.errorEyebrow')}</Text>
        <Text style={styles.cardSub} numberOfLines={2}>
          {clip.errorMessage ?? t('clip.errorDefault')}
        </Text>
        <View style={styles.actionRow}>
          <SmallActionBtn label={t('common.delete')} onPress={() => onRemove?.(clip)} />
          <SmallActionBtn label={t('clip.tryAgain')} onPress={() => onRetry?.(clip)} accent />
        </View>
      </View>
    </View>
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
  cardMuted: { backgroundColor: colors.paperDeep },

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
  cardFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  cardSub: { ...typography.caption, color: colors.textMute },

  eyebrowMuted: { ...typography.labelSmall, color: colors.textMute, marginTop: 2 },
  eyebrowEmerald: { ...typography.labelSmall, color: colors.emeraldDeep },
  eyebrowDanger: { ...typography.labelSmall, color: colors.danger, marginTop: 2 },

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
  indeterminateFill: {
    height: 4,
    backgroundColor: colors.emerald,
    borderRadius: 2,
  },

  cornerBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
    backgroundColor: colors.paperDeep,
    borderWidth: 1, borderColor: colors.border,
  },
  cornerBtnPressed: { backgroundColor: colors.borderLight },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 8 },
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
