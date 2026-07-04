import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { getRecordingConfig, type Clip } from '../dataflow';
import { clipTitle } from '../domain/clipLabels';
import { useT, getLocale } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// v0.1.4 クリップカード (= マイビデオ = アップロード待ち一覧)。
//
//   recorded:  サムネ + 撮影日時 + 尺 + 構成。 タップでプレビューポップ (= 同意 → アップロード)
//   uploading: 進捗バー (タップ不可)
//   error:     エラー文言 + 「もう一度試す」 「削除」
//
// uploaded はそもそも一覧に出さない (= CollectionScreen が filter)。

interface Props {
  clip: Clip;
  /// recorded / error 行のタップでプレビューポップを開く。
  onOpen?: (clip: Clip) => void;
  onRemove?: (clip: Clip) => void;
  onRetry?: (clip: Clip) => void;
}

export const ClipCard: React.FC<Props> = ({ clip, onOpen, onRemove, onRetry }) => {
  switch (clip.state) {
    case 'recorded':
      return <RecordedCard clip={clip} onOpen={onOpen} />;
    case 'uploading':
      return <UploadingCard clip={clip} />;
    case 'error':
      return <ErrorCard clip={clip} onOpen={onOpen} onRemove={onRemove} onRetry={onRetry} />;
    case 'uploaded':
      return null; // 一覧に出さない (= 保険。 通常は CollectionScreen が filter 済み)
  }
};

// ─── サムネイル (= ローカル録画 mp4 から 1 フレーム生成、 モジュールキャッシュ) ───────

const thumbCache = new Map<string, string>();

/** クリップのローカル録画 mp4 URI (= 撮影構成の primary video)。 無ければ null。 */
export function localVideoUri(clip: Clip): string | null {
  if (!clip.sessionDir || !clip.recordingConfigId) return null;
  const config = getRecordingConfig(clip.recordingConfigId);
  if (!config) return null;
  try {
    return config.primaryVideoUri({ sessionDir: clip.sessionDir });
  } catch {
    return null;
  }
}

const ClipThumb: React.FC<{ clip: Clip; muted?: boolean }> = ({ clip, muted }) => {
  const uri = localVideoUri(clip);
  const key = clip.id;
  const [thumb, setThumb] = useState<string | null>(thumbCache.get(key) ?? null);

  useEffect(() => {
    if (!uri || thumbCache.has(key)) return;
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(uri, { time: 800, quality: 0.5 })
      .then((r) => { thumbCache.set(key, r.uri); if (!cancelled) setThumb(r.uri); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uri, key]);

  return (
    <View style={[styles.thumb, muted && styles.thumbMuted]}>
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumbImage} resizeMode="cover" />
      ) : (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Circle cx={11} cy={11} r={10} stroke={colors.textFaint} strokeWidth={1.2} />
          <Polygon points="9,7.5 15,11 9,14.5" fill={colors.textFaint} />
        </Svg>
      )}
    </View>
  );
};

const ClipName: React.FC<{ clip: Clip }> = ({ clip }) => (
  <Text style={styles.cardName} numberOfLines={1}>
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

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || ms <= 0) return null;
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── アップロード待ち (= タップでプレビューポップ) ─────────────────────

const RecordedCard: React.FC<{ clip: Clip; onOpen?: (c: Clip) => void }> = ({ clip, onOpen }) => {
  const t = useT();
  const dur = formatDuration(clip.durationMs);
  return (
    <Pressable
      onPress={() => onOpen?.(clip)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityLabel={t('clip.recorded')}
    >
      <ClipThumb clip={clip} />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <View style={styles.cardMeta}>
          <Text style={styles.eyebrowMuted}>{t('clip.recorded')}</Text>
          <Text style={styles.cardSub}>
            · {formatTimestamp(clip.createdAt)}
            {dur ? ` · ${dur}` : ''}
            {clip.recordingConfigId ? ` · ${clip.recordingConfigId}` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

// ─── アップロード中 ─────────────────────────────────────────────────────

const UploadingCard: React.FC<{ clip: Clip }> = ({ clip }) => {
  const t = useT();
  const progress = Math.max(0, Math.min(1, clip.uploadProgress ?? 0));
  return (
    <View style={styles.card}>
      <ClipThumb clip={clip} />
      <View style={styles.cardMid}>
        <ClipName clip={clip} />
        <Text style={styles.eyebrowMuted}>{t('clip.uploading')} · {Math.round(progress * 100)}%</Text>
        <IndeterminateOrFill progress={progress} />
      </View>
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

// ─── エラー ────────────────────────────────────────────────────────────

const ErrorCard: React.FC<{
  clip: Clip;
  onOpen?: (c: Clip) => void;
  onRemove?: (c: Clip) => void; onRetry?: (c: Clip) => void;
}> = ({ clip, onOpen, onRemove, onRetry }) => {
  const t = useT();
  return (
    <Pressable
      onPress={() => onOpen?.(clip)}
      style={({ pressed }) => [styles.card, styles.cardMuted, pressed && styles.cardPressed]}
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
          <SmallActionBtn label={t('clip.tryAgain')} onPress={() => onRetry?.(clip)} accent />
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

  // 横持ち前提: サムネは 16:9 で大きめ (= 動画の中身がわかることが最優先)。
  thumb: {
    width: 128,
    aspectRatio: 16 / 9,
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

  cardMid: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    gap: 4,
  },
  cardName: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' },
  cardSub: { ...typography.caption, color: colors.textMute },

  eyebrowMuted: { ...typography.labelSmall, color: colors.textMute },
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

// Suppress unused warning
void Line;
