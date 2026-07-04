// プレビューポップ (= マイビデオのカードタップで開く、 v0.1.4 UI_SPECS)。
//
// ローカル録画 mp4 をその場で再生し、 「うつってはいけないものがないか」 をユーザー自身が確認してから
// アップロードする (= 同意はアップロードボタンを押す行為そのもの)。
//
// 横持ち前提のレイアウト: 左に動画 (16:9)、 右に説明 + ボタン列。
// アップロード開始でポップは閉じ、 進捗は一覧のカードに出る (= uploaded でカードごと消える)。

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';

import type { Clip } from '../dataflow';
import { localVideoUri, formatDuration } from './ClipCard';
import { clipTitle } from '../domain/clipLabels';
import { useT } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';

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
        {/* カード内タップでは閉じない (= stopPropagation 相当) */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {/* 左: 動画プレビュー */}
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
                <Text style={styles.videoMissingText}>{t('clip.errorDefault')}</Text>
              </View>
            )}
          </View>

          {/* 右: 説明 + アクション */}
          <View style={styles.side}>
            <Text style={styles.title} numberOfLines={2}>{clipTitle(clip)}</Text>
            <Text style={styles.meta}>
              {dur ? `${dur} · ` : ''}{clip.recordingConfigId ?? ''}
            </Text>
            <Text style={styles.hint}>{t('upload.confirmHint')}</Text>

            <View style={styles.spacer} />

            <Pressable
              onPress={() => onUpload(clip)}
              style={({ pressed }) => [styles.uploadBtn, pressed && styles.btnPressed]}
            >
              <Text style={styles.uploadBtnLabel}>{t('upload.action')}</Text>
            </Pressable>
            <View style={styles.subRow}>
              <Pressable
                onPress={() => onRemove(clip)}
                style={({ pressed }) => [styles.subBtn, pressed && styles.btnPressed]}
              >
                <Text style={styles.subBtnLabelDanger}>{t('common.delete')}</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.subBtn, pressed && styles.btnPressed]}
              >
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
    backgroundColor: 'rgba(20,16,8,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  // 横持ち: 左 = 動画、 右 = テキスト + ボタン
  sheet: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderRadius: radii.xl,
    overflow: 'hidden',
    width: '88%',
    maxWidth: 720,
    maxHeight: '90%',
  },
  videoWrap: {
    flex: 3,
    backgroundColor: '#000',
    aspectRatio: 16 / 9,
    alignSelf: 'center',
  },
  video: { width: '100%', height: '100%' },
  videoMissing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  videoMissingText: { ...typography.caption, color: '#fff', textAlign: 'center' },

  side: {
    flex: 2,
    padding: spacing.lg,
    gap: 6,
  },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: 16,
    color: colors.ink,
  },
  meta: { ...typography.caption, color: colors.textMute },
  hint: { ...typography.caption, color: colors.textBody, lineHeight: 18, marginTop: 4 },
  spacer: { flex: 1 },

  uploadBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radii.full,
    paddingVertical: 12,
    alignItems: 'center',
  },
  uploadBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 0.3,
  },
  subRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: 4 },
  subBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  subBtnLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.textMute },
  subBtnLabelDanger: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.danger },
  btnPressed: { opacity: 0.65 },
});
