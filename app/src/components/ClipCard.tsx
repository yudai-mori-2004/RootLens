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
import { useT, getLocale } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// v0.1.4 クリップカード (= マイビデオの横一列スクロール用)。
//
// ボタンは持たない: 16:9 サムネ + 左上に状態チップ + 右下に尺タグ、 その下に日付と撮影時刻。
// タップでプレビューポップが開き、 動画を確認 → 同意チェック → アップロード / 削除は全部そちらで行う。
// uploading 中のみタップ不可 (= サムネ下端に進捗バー)。

/** デザイン検証用モックの型 (= CollectionScreen の DESIGN_PREVIEW から渡る)。 */
export interface DesignMock {
  clip: Partial<Clip> & Pick<Clip, 'id' | 'state' | 'createdAt'>;
  thumb?: ImageSourcePropType;
}

interface Props {
  clip: Clip;
  /// カード幅 (= 横一列レイアウトなので親が決める)
  width: number;
  /// モック用サムネ上書き (= 実クリップでは undefined、 ローカル mp4 から生成)
  previewSource?: ImageSourcePropType;
  onOpen?: (clip: Clip) => void;
}

export const ClipCard: React.FC<Props> = ({ clip, width, previewSource, onOpen }) => {
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
      style={({ pressed }) => [{ width }, pressed && !isUploading && styles.pressed]}
    >
      {/* ── サムネ (= カード本体) ── */}
      <View style={styles.thumbFrame}>
        <ClipThumb clip={clip} previewSource={previewSource} dimmed={isUploading} />

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

        {dur ? (
          <View style={styles.durationTag}>
            <Text style={styles.durationText}>{dur}</Text>
          </View>
        ) : null}

        {isUploading ? <ProgressEdge progress={progress} /> : null}
      </View>

      {/* ── サムネ下: 日付 + 撮影時刻 ── */}
      <View style={styles.caption}>
        <Text style={styles.captionDate}>{formatCardDate(clip.createdAt)}</Text>
        <Text style={styles.captionTime}>
          {formatCardTime(clip.createdAt)}
          {clip.recordingConfigId ? `  ·  ${configLabel(clip.recordingConfigId)}` : ''}
        </Text>
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
          <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
            <Circle cx={14} cy={14} r={13} stroke={colors.textFaint} strokeWidth={1.2} />
            <Polygon points="11,9 19.5,14 11,19" fill={colors.textFaint} />
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

export function formatCardDate(ts: number): string {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  return new Date(ts).toLocaleDateString(tag, { month: 'long', day: 'numeric' });
}

export function formatCardTime(ts: number): string {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  return new Date(ts).toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || ms <= 0) return null;
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function configLabel(id: string): string {
  if (id === 'ultra_wide') return '超広角';
  if (id === 'arkit') return 'ARKit';
  return id;
}

// ─── styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },

  thumbFrame: {
    position: 'relative',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.paperDeep,
    ...shadows.card,
  },
  thumb: {
    width: '100%',
    aspectRatio: 16 / 9,
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

  caption: {
    paddingTop: spacing.sm + 2,
    paddingHorizontal: 2,
    gap: 1,
  },
  captionDate: {
    fontFamily: fonts.serifMedium,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  captionTime: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMute,
  },
});
