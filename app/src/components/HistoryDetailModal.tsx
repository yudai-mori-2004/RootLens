// 履歴詳細ポップ (= マイビデオの履歴タイルをタップで開く)。
//
// アップロード済みクリップの動画は端末に残っていないので、 サーバの presigned GET URL
// (= GET /api/clips/:id/media) を取得して R2 から直接ストリーミング再生する。
// 右側に撮影日時・長さ・撮影モード・容量などの詳細を並べる。

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';

import { fetchClipMediaUrl, type ServerClipStatus } from '../dataflow';
import { formatCardDate, formatCardTime, formatDuration, configLabel } from './ClipCard';
import { getCurrentSession } from '../services/auth/instance';
import { useT } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

interface Props {
  visible: boolean;
  clip: ServerClipStatus | null;
  /// 端末に永続化済みのサムネ (= 動画ロード中のつなぎ表示)
  thumbSource?: ImageSourcePropType;
  onClose: () => void;
}

export const HistoryDetailModal: React.FC<Props> = ({ visible, clip, thumbSource, onClose }) => {
  const t = useT();
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    setMediaUrl(null);
    setMediaError(false);
    if (!visible || !clip) return;
    let cancelled = false;
    (async () => {
      try {
        const session = getCurrentSession();
        if (!session) throw new Error('no session');
        const url = await fetchClipMediaUrl(clip.id, session.pubkey);
        if (!cancelled) setMediaUrl(url);
      } catch {
        if (!cancelled) setMediaError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, clip?.id]);

  if (!clip) return null;

  const createdMs = clip.createdAt ? new Date(clip.createdAt).getTime() : null;
  const dur = formatDuration(clip.durationMs);
  const sizeMb = clip.contentSize != null ? `${(clip.contentSize / 1_000_000).toFixed(0)} MB` : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['landscape']}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {/* ── 左: 再生枠 ── */}
          <View style={styles.videoWrap}>
            {mediaUrl ? (
              <Video
                source={{ uri: mediaUrl }}
                style={styles.video}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                shouldPlay
              />
            ) : (
              <View style={styles.videoPlaceholder}>
                {thumbSource ? (
                  <Image source={thumbSource} style={styles.videoPoster} resizeMode="cover" />
                ) : null}
                <View style={styles.videoOverlay}>
                  {mediaError ? (
                    <Text style={styles.videoErrorText}>{t('history.videoUnavailable')}</Text>
                  ) : (
                    <ActivityIndicator color={colors.paper} />
                  )}
                </View>
              </View>
            )}
          </View>

          {/* ── 右: 詳細 ── */}
          <View style={styles.side}>
            <Text style={styles.eyebrow}>{t('portfolio.uploadedLabel')}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {createdMs != null ? `${formatCardDate(createdMs)} ${formatCardTime(createdMs)}` : '—'}
            </Text>

            <View style={styles.rule} />

            <MetaRow label={t('history.duration')} value={dur ?? '—'} />
            <MetaRow
              label={t('history.config')}
              value={clip.recordingConfig ? configLabel(clip.recordingConfig) : '—'}
            />
            {sizeMb ? <MetaRow label={t('history.size')} value={sizeMb} /> : null}
            {clip.deviceModel ? <MetaRow label={t('history.device')} value={clip.deviceModel} /> : null}

            <View style={styles.spacer} />

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
            >
              <Text style={styles.closeBtnLabel}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const MetaRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.metaRow}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 8, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    width: '88%',
    maxWidth: 780,
    ...shadows.pop,
  },
  // aspectRatio は付けない: side の高さにストレッチし、 動画は CONTAIN で箱内 letterbox する
  // (= 動画の下に sheet 背景の隙間ができない。 余白は箱と同色の黒)
  videoWrap: {
    flex: 56,
    alignSelf: 'stretch',
    backgroundColor: '#0B0D11',
  },
  video: { width: '100%', height: '100%' },
  videoPlaceholder: { flex: 1 },
  videoPoster: { ...StyleSheet.absoluteFillObject, opacity: 0.45 },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  videoErrorText: {
    ...typography.caption,
    color: colors.paper,
    textAlign: 'center',
  },

  side: {
    flex: 44,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignSelf: 'stretch',
    minHeight: 300,
  },
  eyebrow: {
    ...typography.labelSmall,
    color: colors.emeraldDeep,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.serifMedium,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    gap: spacing.md,
  },
  metaLabel: { ...typography.caption, fontSize: 12, color: colors.textMute },
  metaValue: {
    ...typography.captionMedium,
    fontSize: 12.5,
    color: colors.ink,
    flexShrink: 1,
    textAlign: 'right',
  },
  spacer: { flex: 1, minHeight: spacing.md },

  closeBtn: {
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 11,
    alignItems: 'center',
  },
  closeBtnPressed: { backgroundColor: colors.paperDeep },
  closeBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.ink,
  },
});
