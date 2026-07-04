import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { getRecordingConfig, type Clip } from '../dataflow';
import { clipTitle } from '../domain/clipLabels';
import { useT, getLocale } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// v0.1.4 クリップカード (= マイビデオ = アップロード待ち一覧)。
//
// 写真主体の縦型カード: 16:9 サムネの上に状態チップ、 下に題字 + メタ 1 行。
//   recorded:  タップでプレビューポップ (= 同意 → アップロード)
//   uploading: サムネ下端に進捗バー + チップに % (タップ不可)
//   error:     danger チップ + エラー文 + 「削除 / もう一度」
//
// uploaded はそもそも一覧に出さない (= CollectionScreen が filter)。

/** デザイン検証用モックの型 (= CollectionScreen の DESIGN_PREVIEW から渡る)。 */
export interface DesignMock {
  clip: Partial<Clip> & Pick<Clip, 'id' | 'state' | 'createdAt'>;
  thumb?: ImageSourcePropType;
}

interface Props {
  clip: Clip;
  /// モック用サムネ上書き (= 実クリップでは undefined、 ローカル mp4 から生成)
  previewSource?: ImageSourcePropType;
  onOpen?: (clip: Clip) => void;
  onRemove?: (clip: Clip) => void;
  onRetry?: (clip: Clip) => void;
}

export const ClipCard: React.FC<Props> = ({ clip, previewSource, onOpen, onRemove, onRetry }) => {
  const t = useT();
  const isError = clip.state === 'error';
  const isUploading = clip.state === 'uploading';
  if (clip.state === 'uploaded') return null;

  const dur = formatDuration(clip.durationMs);
  const progress = Math.max(0, Math.min(1, clip.uploadProgress ?? 0));

  return (
    <Pressable
      onPress={() => !isUploading && onOpen?.(clip)}
      disabled={isUploading}
      style={({ pressed }) => [styles.card, pressed && !isUploading && styles.cardPressed]}
    >
      {/* ── サムネ ── */}
      <View style={styles.thumbWrap}>
        <ClipThumb clip={clip} previewSource={previewSource} dimmed={isUploading} />

        {/* 状態チップ (= 左上) */}
        {isError ? (
          <View style={[styles.chip, styles.chipDanger]}>
            <Text style={styles.chipTextLight}>{t('clip.errorEyebrow')}</Text>
          </View>
        ) : isUploading ? (
          <View style={[styles.chip, styles.chipInk]}>
            <Text style={styles.chipTextLight}>
              {t('clip.uploading')}{progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}
            </Text>
          </View>
        ) : null}

        {/* 尺 (= 右下、 動画アプリの文法) */}
        {dur ? (
          <View style={styles.durationTag}>
            <Text style={styles.durationText}>{dur}</Text>
          </View>
        ) : null}

        {/* アップロード進捗 (= サムネ下端) */}
        {isUploading ? <ProgressEdge progress={progress} /> : null}
      </View>

      {/* ── 本文 ── */}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{clipTitle(clip)}</Text>
        {isError ? (
          <>
            <Text style={styles.errorText} numberOfLines={2}>
              {clip.errorMessage ?? t('clip.errorDefault')}
            </Text>
            <View style={styles.actionRow}>
              <Pressable onPress={() => onRetry?.(clip)} style={({ pressed }) => [styles.retryBtn, pressed && styles.btnPressed]} hitSlop={6}>
                <Text style={styles.retryLabel}>{t('clip.tryAgain')}</Text>
              </Pressable>
              <Pressable onPress={() => onRemove?.(clip)} style={({ pressed }) => [styles.deleteBtn, pressed && styles.btnPressed]} hitSlop={6}>
                <Text style={styles.deleteLabel}>{t('common.delete')}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={styles.meta} numberOfLines={1}>
            {clip.recordingConfigId ? configLabel(clip.recordingConfigId) : ''}
          </Text>
        )}
      </View>
    </Pressable>
  );
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

const ClipThumb: React.FC<{
  clip: Clip;
  previewSource?: ImageSourcePropType;
  dimmed?: boolean;
}> = ({ clip, previewSource, dimmed }) => {
  const uri = localVideoUri(clip);
  const key = clip.id;
  const [thumb, setThumb] = useState<string | null>(thumbCache.get(key) ?? null);

  useEffect(() => {
    if (!uri || thumbCache.has(key)) return;
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(uri, { time: 800, quality: 0.6 })
      .then((r) => { thumbCache.set(key, r.uri); if (!cancelled) setThumb(r.uri); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uri, key]);

  const source = previewSource ?? (thumb ? { uri: thumb } : null);

  return (
    <View style={styles.thumb}>
      {source ? (
        <Image source={source} style={[styles.thumbImage, dimmed && styles.thumbDimmed]} resizeMode="cover" />
      ) : (
        <View style={styles.thumbFallback}>
          <Svg width={26} height={26} viewBox="0 0 26 26" fill="none">
            <Circle cx={13} cy={13} r={12} stroke={colors.textFaint} strokeWidth={1.2} />
            <Polygon points="10.5,8.5 18,13 10.5,17.5" fill={colors.textFaint} />
          </Svg>
        </View>
      )}
    </View>
  );
};

// ─── 進捗バー (= サムネ下端の 3px) ──────────────────────────────────────

const ProgressEdge: React.FC<{ progress: number }> = ({ progress }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    if (progress > 0) return;
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
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
  const segW = Math.max(30, trackW * 0.35);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-segW, trackW] });
  return (
    <View style={styles.progressTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {trackW > 0 ? (
        <Animated.View style={[styles.progressFill, { width: segW, transform: [{ translateX }] }]} />
      ) : null}
    </View>
  );
};

// ─── helpers ───────────────────────────────────────────────────────────

const formatTimestamp = (ts: number): string => {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  const d = new Date(ts);
  if (isSameDay(d, new Date())) {
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

function configLabel(id: string): string {
  if (id === 'ultra_wide') return '超広角';
  if (id === 'arkit') return 'ARKit';
  return id;
}

// ─── styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardPressed: { transform: [{ scale: 0.985 }] },

  thumbWrap: { position: 'relative' },
  thumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.paperDeep,
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbDimmed: { opacity: 0.55 },
  thumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  chip: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  chipInk: { backgroundColor: 'rgba(14,31,68,0.88)' },
  chipDanger: { backgroundColor: 'rgba(178,58,46,0.92)' },
  chipTextLight: {
    fontFamily: fonts.sansSemibold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.paper,
  },

  durationTag: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: radii.xs,
    backgroundColor: 'rgba(14,31,68,0.78)',
  },
  durationText: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.paper,
  },

  progressTrack: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: 3,
    backgroundColor: 'rgba(14,31,68,0.18)',
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: colors.emerald },

  body: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 3,
  },
  title: {
    fontFamily: fonts.serifMedium,
    fontSize: 15.5,
    lineHeight: 20,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  meta: { ...typography.caption, fontSize: 11.5, color: colors.textMute },

  errorText: {
    ...typography.caption,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.danger,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 6 },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: colors.ink,
  },
  retryLabel: { fontFamily: fonts.sansSemibold, fontSize: 11, color: colors.paper },
  deleteBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  deleteLabel: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.textMute },
  btnPressed: { opacity: 0.6 },
});
