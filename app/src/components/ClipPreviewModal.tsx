// プレビューポップ (= マイビデオのカードタップで開く)。
//
// ローカル録画 mp4 をその場で再生し、 「うつってはいけないものがないか」 をユーザー自身が
// 確認してからアップロードする (= 同意はアップロードボタンを押す行為そのもの)。
//
// 横持ち前提: 左 = 動画 (16:9)、 右 = 確認テキスト + アクション列。

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';
import { ResizeMode, Video } from 'expo-av';

import type { Clip } from '../dataflow';
import { localVideoUri, formatDuration } from './ClipCard';
import { clipTitle } from '../domain/clipLabels';
import { useT } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

interface Props {
  visible: boolean;
  clip: Clip | null;
  onClose: () => void;
  /// 「アップロードする」 (= 署名 → R2 → 登録 を開始)。 error クリップの再試行も同じ。
  onUpload: (clip: Clip) => void;
  onRemove: (clip: Clip) => void;
}

export const ClipPreviewModal: React.FC<Props> = ({ visible, clip, onClose, onUpload, onRemove }) => {
  const t = useT();
  if (!clip) return null;
  const uri = localVideoUri(clip);
  const dur = formatDuration(clip.durationMs);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['landscape']}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* カード内タップでは閉じない */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {/* ── 左: 動画プレビュー ── */}
          <View style={styles.videoWrap}>
            {uri ? (
              <Video
                source={{ uri }}
                style={styles.video}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                shouldPlay
                isLooping
              />
            ) : (
              <View style={styles.videoMissing}>
                <Svg width={40} height={40} viewBox="0 0 40 40" fill="none">
                  <Circle cx={20} cy={20} r={18.5} stroke={colors.textFaint} strokeWidth={1.4} />
                  <Polygon points="16,12.5 28,20 16,27.5" fill={colors.textFaint} />
                </Svg>
              </View>
            )}
          </View>

          {/* ── 右: 確認 + アクション ── */}
          <View style={styles.side}>
            <Text style={styles.eyebrow}>{t('upload.confirmTitle')}</Text>
            <Text style={styles.title} numberOfLines={2}>{clipTitle(clip)}</Text>
            <Text style={styles.meta}>
              {dur ? `${dur}` : ''}
              {dur && clip.recordingConfigId ? '  ·  ' : ''}
              {clip.recordingConfigId === 'ultra_wide' ? '超広角' : clip.recordingConfigId === 'arkit' ? 'ARKit' : clip.recordingConfigId ?? ''}
            </Text>

            <View style={styles.rule} />
            <Text style={styles.hint}>{t('upload.confirmHint')}</Text>

            <View style={styles.spacer} />

            <Pressable
              onPress={() => onUpload(clip)}
              style={({ pressed }) => [styles.uploadBtn, pressed && styles.uploadBtnPressed]}
            >
              <Text style={styles.uploadBtnLabel}>{t('upload.action')}</Text>
            </Pressable>
            <View style={styles.subRow}>
              <Pressable onPress={() => onRemove(clip)} style={({ pressed }) => [styles.subBtn, pressed && styles.btnPressed]} hitSlop={6}>
                <Text style={styles.subBtnLabelDanger}>{t('common.delete')}</Text>
              </Pressable>
              <View style={styles.subDivider} />
              <Pressable onPress={onClose} style={({ pressed }) => [styles.subBtn, pressed && styles.btnPressed]} hitSlop={6}>
                <Text style={styles.subBtnLabel}>{t('common.close')}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

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
    overflow: 'hidden',
    width: '86%',
    maxWidth: 760,
    ...shadows.pop,
  },
  videoWrap: {
    flex: 58,
    aspectRatio: 16 / 9,
    backgroundColor: '#10131A',
  },
  video: { width: '100%', height: '100%' },
  videoMissing: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  side: {
    flex: 42,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignSelf: 'stretch',
  },
  eyebrow: {
    ...typography.labelSmall,
    color: colors.emeraldDeep,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.serifMedium,
    fontSize: 21,
    lineHeight: 27,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  meta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMute,
    marginTop: 4,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.caption,
    lineHeight: 19,
    color: colors.textBody,
  },
  spacer: { flex: 1, minHeight: spacing.lg },

  uploadBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radii.full,
    paddingVertical: 13,
    alignItems: 'center',
  },
  uploadBtnPressed: { backgroundColor: colors.emeraldDeep },
  uploadBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  subRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  subDivider: { width: 1, height: 12, backgroundColor: colors.border },
  subBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  subBtnLabel: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: colors.textMute },
  subBtnLabelDanger: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: colors.danger },
  btnPressed: { opacity: 0.55 },
});
