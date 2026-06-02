import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import { dataflowStore, storeEventSink, stakeClip, type Clip } from '../dataflow';
import { requireCurrentSession } from '../services/auth';
import { clipTitle } from '../domain/clipLabels';
import { useT } from '../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// ステーキング確認シート。
//
// SPECS_JA §4.2 に従って、 以下を 1 つのシートで提示する:
//   1. ぼかし済みコンテンツのプレビュー (= 「ぼかしの確認」 と同義)
//   2. 品質スコアと内訳
//   3. 想定報酬レンジ
//   4. 撮影内容の確認 (= LEGAL_POLICY D3/D4: 第三者・子ども・私的空間が映っていない表明)
//   5. 撤回不能性 + AI 学習用販売への明示同意 (= 二段階確認の前半)
//   6. ステーキング実行ボタン (= 二段階確認の後半: 最終ダイアログ)
//
// 4 と 5 の両方にチェックして初めて出品可。 同意の根拠は匿名化でなく本人の明示同意に置く
// (= legal/legal-policy D1)。 第三者・子ども・私的空間は顔ぼかしでヘッジせず、 そもそも
// 映っていないことを本人に確認させる (= D3/D4)。

interface Props {
  visible: boolean;
  clip: Clip | null;
  onClose: () => void;
}

export const StakeSheet: React.FC<Props> = ({ visible, clip, onClose }) => {
  const t = useT();
  const [attested, setAttested] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // visible が false になったら次回開いたときに残らないようリセット
  useEffect(() => {
    if (!visible) {
      setAttested(false);
      setAgreed(false);
      setFinalConfirm(false);
      setSubmitting(false);
    }
  }, [visible]);

  if (!clip) return null;

  const canStake = attested && agreed;

  const onStakePress = () => {
    if (!canStake) return;
    setFinalConfirm(true);
  };

  const onFinalConfirm = async () => {
    setSubmitting(true);
    try {
      const wallet = requireCurrentSession().pubkey.toBase58();
      // clip.id = signature_hash。 stakeClip が hash から server id を解決して /stake を叩く。
      const updated = await stakeClip(clip.id, wallet, storeEventSink);
      dataflowStore.getState().applyServerStatus(clip.id, updated);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{t('stake.title')}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
              accessibilityLabel={t('common.close')}
            >
              <Svg width={16} height={16} viewBox="0 0 16 16">
                <Line x1={4} y1={4} x2={12} y2={12} stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
                <Line x1={12} y1={4} x2={4} y2={12} stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* クリップサマリ (= 一意 id = signature_hash) */}
          <View style={styles.taskRow}>
            <View style={[styles.taskThumb, styles.taskThumbEmpty]} />
            <View style={styles.taskMeta}>
              <Text style={styles.eyebrow}>{t('stake.clipEyebrow')}</Text>
              <Text style={styles.taskName} numberOfLines={1} ellipsizeMode="middle">{clipTitle(clip)}</Text>
            </View>
          </View>

          {/* ぼかし済みプレビュー (= サーバ生成 MP4 を再生して確認) */}
          <Section title={t('stake.blurPreview')} hint={t('stake.blurPreviewHint')}>
            <BlurPreviewPlayer videoUrl={clip.previewVideoUrl} fallbackImageUri={clip.previewUris?.[0]} />
          </Section>

          {/* スコア内訳・価格目安は詳細シート側に集約し、 ここでは出さない
              (= 同じ情報を二度見せない / 価格は現段階では蛇足) */}

          {/* 出品前の確認 (= 二段階確認 前半)。 2 つを 1 枚のチェックリストにまとめて分かりやすく。
              1: D3/D4 第三者・子ども・私的空間の非映り込み表明 / 2: D1/D6 販売明示同意 + 撤回不能 */}
          <View style={styles.confirmCard}>
            <Text style={styles.confirmHeading}>{t('stake.confirmHeading')}</Text>

            <Pressable
              onPress={() => setAttested((a) => !a)}
              style={({ pressed }) => [styles.checkItem, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.checkbox, attested && styles.checkboxOn]}>
                {attested ? <CheckMark /> : null}
              </View>
              <View style={styles.checkTextWrap}>
                <Text style={styles.checkItemTitle}>{t('stake.attestTitle')}</Text>
                <Text style={styles.checkItemBody}>{t('stake.attestBody')}</Text>
              </View>
            </Pressable>

            <View style={styles.checkDivider} />

            <Pressable
              onPress={() => setAgreed((a) => !a)}
              style={({ pressed }) => [styles.checkItem, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                {agreed ? <CheckMark /> : null}
              </View>
              <View style={styles.checkTextWrap}>
                <Text style={styles.checkItemTitle}>{t('stake.irrevocableTitle')}</Text>
                <Text style={styles.checkItemBody}>{t('stake.consentBody')}</Text>
              </View>
            </Pressable>
          </View>
        </ScrollView>

        {/* 実行ボタン (= sticky footer) */}
        <View style={styles.footer}>
          <Pressable
            onPress={onStakePress}
            disabled={!canStake || submitting}
            style={({ pressed }) => [
              styles.stakeBtn,
              !canStake && styles.stakeBtnDisabled,
              pressed && canStake && styles.stakeBtnPressed,
            ]}
          >
            <Text style={[styles.stakeBtnLabel, !canStake && styles.stakeBtnLabelDisabled]}>
              {t('stake.cta')}
            </Text>
          </Pressable>
        </View>

        {/* 最終確認ダイアログ (= SPECS §4.2 二段階確認 後半) */}
        <Modal
          visible={finalConfirm}
          animationType="fade"
          transparent
          onRequestClose={() => setFinalConfirm(false)}
        >
          <View style={styles.dialogBackdrop}>
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>{t('stake.confirmTitle')}</Text>
              <Text style={styles.dialogBody}>
                {t('stake.confirmBody')}
              </Text>
              <View style={styles.dialogActions}>
                <Pressable
                  onPress={() => setFinalConfirm(false)}
                  disabled={submitting}
                  style={({ pressed }) => [styles.dialogBtn, pressed && styles.dialogBtnPressed]}
                >
                  <Text style={styles.dialogBtnLabel}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={onFinalConfirm}
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.dialogBtn,
                    styles.dialogBtnConfirm,
                    pressed && styles.dialogBtnPressed,
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={[styles.dialogBtnLabel, styles.dialogBtnLabelConfirm]}>
                      {t('stake.confirmExecute')}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
};

// ─── 補助 component ─────────────────────────────────────────────────

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title, hint, children,
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

const CheckMark: React.FC = () => (
  <Svg width={12} height={12} viewBox="0 0 12 12">
    <Line x1={2} y1={6.5} x2={5} y2={9.5} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
    <Line x1={5} y1={9.5} x2={10} y2={3} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

/// サーバ生成のぼかし済 MP4 を再生。 まだ準備中 (= サーバ処理完了前) は撮影時 snapshot を見せる。
const BlurPreviewPlayer: React.FC<{
  videoUrl?: string;
  fallbackImageUri?: string;
}> = ({ videoUrl, fallbackImageUri }) => {
  const t = useT();
  if (videoUrl) {
    return (
      <View style={styles.previewVideoWrap}>
        <Video
          source={{ uri: videoUrl }}
          style={styles.previewVideo}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          isLooping={false}
          shouldPlay={false}
        />
      </View>
    );
  }
  if (fallbackImageUri) {
    return (
      <View style={styles.previewVideoWrap}>
        <Image source={{ uri: fallbackImageUri }} style={styles.previewVideo} resizeMode="contain" />
        <View style={styles.previewVideoOverlay}>
          <Text style={styles.previewPlaceholderText}>{t('stake.previewPreparing')}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.previewVideoWrap, styles.previewPlaceholder]}>
      <Text style={styles.previewPlaceholderText}>{t('stake.previewNotReady')}</Text>
    </View>
  );
};

// ─── styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },

  header: {
    paddingTop: 8,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.paper,
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: {
    fontFamily: fonts.serifSemibold,
    fontSize: 22,
    color: colors.ink,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  closeBtnPressed: { backgroundColor: colors.paperDeep },

  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },

  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.card,
  },
  taskThumb: {
    width: 56, height: 56, borderRadius: radii.md,
    backgroundColor: colors.paperDeep,
    borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  taskThumbEmpty: {},
  taskMeta: { flex: 1, gap: 2 },
  taskName: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  eyebrow: { ...typography.labelSmall, color: colors.textMute },

  section: { gap: spacing.sm },
  sectionTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.ink,
    letterSpacing: 0.1,
  },
  sectionHint: {
    ...typography.caption,
    color: colors.textMute,
    marginTop: -2,
  },
  sectionBody: { marginTop: 4 },

  previewVideoWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.bgInk,
    position: 'relative',
  },
  previewVideo: { width: '100%', height: '100%' },
  previewVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,18,38,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  previewPlaceholderText: {
    ...typography.caption,
    color: '#fff',
  },

  scoreCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  scoreNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  scoreNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 56,
    color: colors.ink,
    letterSpacing: -1.5,
    lineHeight: 60,
  },
  scoreOutOf: {
    ...typography.label,
    color: colors.textMute,
  },

  breakdownList: { gap: spacing.sm },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  breakdownLabel: {
    flex: 1,
    ...typography.caption,
    color: colors.textBody,
  },
  breakdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: 130,
  },
  breakdownValue: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink,
    minWidth: 40,
    textAlign: 'right',
  },
  breakdownBarTrack: {
    flex: 1,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  breakdownBarFill: { height: 4, backgroundColor: colors.emerald, borderRadius: 2 },

  rewardCard: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  rewardLow: {
    fontFamily: fonts.serifMedium,
    fontSize: 28,
    color: colors.ink,
  },
  rewardSep: {
    fontFamily: fonts.sansRegular,
    fontSize: 18,
    color: colors.textMute,
    marginHorizontal: 4,
  },
  rewardHigh: {
    fontFamily: fonts.serifMedium,
    fontSize: 28,
    color: colors.emeraldDeep,
  },
  rewardUnit: {
    ...typography.label,
    color: colors.textMute,
    marginLeft: 6,
  },

  confirmCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  confirmHeading: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.ink,
    letterSpacing: 0.1,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  checkTextWrap: { flex: 1, gap: 3 },
  checkItemTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13.5,
    color: colors.ink,
  },
  checkItemBody: {
    ...typography.caption,
    color: colors.textBody,
    lineHeight: 19,
  },
  checkDivider: { height: 1, backgroundColor: colors.border },
  checkbox: {
    width: 20, height: 20, borderRadius: 4,
    borderWidth: 1.5, borderColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    marginTop: 1,
  },
  checkboxOn: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },

  footer: {
    padding: spacing.lg,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stakeBtn: {
    paddingVertical: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.ink,
    alignItems: 'center',
  },
  stakeBtnDisabled: { backgroundColor: colors.borderStrong },
  stakeBtnPressed: { backgroundColor: colors.inkSoft },
  stakeBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: '#fff',
    letterSpacing: 0.4,
  },
  stakeBtnLabelDisabled: { color: colors.textOnInk },

  // 最終確認ダイアログ
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,18,38,0.55)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dialogCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxWidth: 380,
    width: '100%',
  },
  dialogTitle: {
    fontFamily: fonts.serifSemibold,
    fontSize: 18,
    color: colors.ink,
  },
  dialogBody: {
    ...typography.body,
    color: colors.textBody,
    lineHeight: 21,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  dialogBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  dialogBtnPressed: { opacity: 0.7 },
  dialogBtnConfirm: { backgroundColor: colors.ink, borderColor: colors.ink },
  dialogBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.textBody,
  },
  dialogBtnLabelConfirm: { color: '#fff' },
});
