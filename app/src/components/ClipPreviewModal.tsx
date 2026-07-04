// プレビューポップ (= マイビデオのカードタップで開く)。
//
// カード側にはボタンを置かない方針なので、 確認と操作は全部ここ:
//   1. ローカル録画 mp4 をその場で再生して中身を確認する
//   2. 同意チェック 「うつってはいけないものが映っていないことを確認しました」
//   3. チェック済みのときだけ 「アップロードする」 が押せる
//   4. 削除は「元に戻せない」 ことを確認ダイアログで念押ししてから実行
//
// 横持ち前提: 左 = 動画 (16:9)、 右 = 確認テキスト + 同意 + アクション列。

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { ResizeMode, Video } from 'expo-av';

import type { Clip } from '../dataflow';
import { localVideoUri, formatDuration, formatCardDate, formatCardTime, configLabel } from './ClipCard';
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
  const [consented, setConsented] = useState(false);

  // 開くたび / 対象が変わるたびに同意をリセットする (= 動画ごとに確認してもらう)
  useEffect(() => {
    setConsented(false);
  }, [visible, clip?.id]);

  if (!clip) return null;
  const uri = localVideoUri(clip);
  const dur = formatDuration(clip.durationMs);

  const onPressDelete = () => {
    Alert.alert(
      t('upload.deleteTitle'),
      t('upload.deleteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('upload.deleteConfirm'), style: 'destructive', onPress: () => onRemove(clip) },
      ],
    );
  };

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

          {/* ── 右: 確認 + 同意 + アクション ── */}
          <View style={styles.side}>
            <Text style={styles.eyebrow}>{t('upload.confirmTitle')}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {formatCardDate(clip.createdAt)} {formatCardTime(clip.createdAt)}
            </Text>
            <Text style={styles.meta}>
              {dur ?? ''}
              {dur && clip.recordingConfigId ? '  ·  ' : ''}
              {clip.recordingConfigId ? configLabel(clip.recordingConfigId) : ''}
            </Text>

            {clip.state === 'error' && clip.errorMessage ? (
              <Text style={styles.errorNote} numberOfLines={2}>{clip.errorMessage}</Text>
            ) : null}

            <View style={styles.spacer} />

            {/* 同意チェック */}
            <Pressable
              onPress={() => setConsented((v) => !v)}
              style={({ pressed }) => [styles.consentRow, pressed && styles.pressedDim]}
              hitSlop={6}
            >
              <View style={[styles.checkbox, consented && styles.checkboxOn]}>
                {consented ? (
                  <Svg width={12} height={12} viewBox="0 0 12 12">
                    <Path d="M2 6.2 L4.8 9 L10 3.4" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </Svg>
                ) : null}
              </View>
              <Text style={styles.consentLabel}>{t('upload.consentCheck')}</Text>
            </Pressable>

            <Pressable
              onPress={() => onUpload(clip)}
              disabled={!consented}
              style={({ pressed }) => [
                styles.uploadBtn,
                !consented && styles.uploadBtnDisabled,
                pressed && consented && styles.uploadBtnPressed,
              ]}
            >
              <Text style={styles.uploadBtnLabel}>{t('upload.action')}</Text>
            </Pressable>

            <View style={styles.subRow}>
              <Pressable onPress={onPressDelete} style={({ pressed }) => [styles.subBtn, pressed && styles.pressedDim]} hitSlop={6}>
                <Text style={styles.subBtnLabelDanger}>{t('common.delete')}</Text>
              </Pressable>
              <View style={styles.subDivider} />
              <Pressable onPress={onClose} style={({ pressed }) => [styles.subBtn, pressed && styles.pressedDim]} hitSlop={6}>
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
  videoMissing: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  meta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMute,
    marginTop: 4,
  },
  errorNote: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 17,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  spacer: { flex: 1, minHeight: spacing.md },

  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
    marginBottom: spacing.md,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.4,
    borderColor: colors.inkMute,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  consentLabel: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textBody,
    flex: 1,
  },

  uploadBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radii.full,
    paddingVertical: 13,
    alignItems: 'center',
  },
  uploadBtnDisabled: { backgroundColor: colors.border },
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
  pressedDim: { opacity: 0.55 },
});
