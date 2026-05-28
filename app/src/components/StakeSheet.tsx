import React, { useEffect, useMemo, useState } from 'react';
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
import { clipStore, type Clip, type QualityBreakdown } from '../services/clipPipeline';
import { findTask } from '../domain/taskCatalog';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// ステーキング確認シート。
//
// SPECS_JA §4.2 に従って、 以下を 1 つのシートで提示する:
//   1. ぼかし済みコンテンツのプレビュー (= 「ぼかしの確認」 と同義)
//   2. 品質スコアと内訳
//   3. 想定報酬レンジ
//   4. 撤回不能性の注意喚起 + 撮影者の明示同意 (= 二段階確認の前半)
//   5. ステーキング実行ボタン (= 二段階確認の後半: 最終ダイアログ)
//
// ぼかしの確認 / Root NFT 発行の承認 / ステーキング を別画面に分けず、 同じ意思決定の中に置く。

interface Props {
  visible: boolean;
  clip: Clip | null;
  onClose: () => void;
}

export const StakeSheet: React.FC<Props> = ({ visible, clip, onClose }) => {
  const [agreed, setAgreed] = useState(false);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // visible が false になったら次回開いたときに残らないようリセット
  useEffect(() => {
    if (!visible) {
      setAgreed(false);
      setFinalConfirm(false);
      setSubmitting(false);
    }
  }, [visible]);

  const task = useMemo(() => (clip ? findTask(clip.taskId) : undefined), [clip]);

  if (!clip) return null;

  const onStakePress = () => {
    if (!agreed) return;
    setFinalConfirm(true);
  };

  const onFinalConfirm = async () => {
    setSubmitting(true);
    try {
      await clipStore.stake(clip.id);
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
            <Text style={styles.headerTitle}>ステーキング</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
              accessibilityLabel="閉じる"
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
          {/* タスクサマリ */}
          <View style={styles.taskRow}>
            {task ? (
              <Image source={task.illustration} style={styles.taskThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.taskThumb, styles.taskThumbEmpty]} />
            )}
            <View style={styles.taskMeta}>
              <Text style={styles.eyebrow}>TASK</Text>
              <Text style={styles.taskName}>{task?.name ?? clip.id}</Text>
            </View>
          </View>

          {/* ぼかし済みプレビュー (= サーバ生成 MP4 を再生して確認) */}
          <Section title="ぼかし済みプレビュー" hint="再生して、 顔と文字が全フレームで適切にぼかされているか確認してください">
            <BlurPreviewPlayer videoUrl={clip.previewVideoUrl} fallbackImageUri={clip.previewUris?.[0]} />
          </Section>

          {/* 品質スコア */}
          <Section title="品質スコア" hint="サーバ側パイプラインによる評価結果">
            <View style={styles.scoreCard}>
              <View style={styles.scoreNumberRow}>
                <Text style={styles.scoreNumber}>{clip.qualityScore ?? '—'}</Text>
                <Text style={styles.scoreOutOf}>/ 100</Text>
              </View>
              {clip.qualityBreakdown ? (
                <QualityBreakdownDisplay breakdown={clip.qualityBreakdown} />
              ) : null}
            </View>
          </Section>

          {/* 想定報酬 */}
          <Section title="想定報酬レンジ" hint="ライセンス販売時の参考値、 実販売価格は別途決定">
            <View style={styles.rewardCard}>
              <Text style={styles.rewardLow}>${(clip.reward?.rangeUsdcLow ?? 0).toFixed(2)}</Text>
              <Text style={styles.rewardSep}>〜</Text>
              <Text style={styles.rewardHigh}>${(clip.reward?.rangeUsdcHigh ?? 0).toFixed(2)}</Text>
              <Text style={styles.rewardUnit}>USDC</Text>
            </View>
          </Section>

          {/* 撤回不能性の注意喚起 (= SPECS §4.2 二段階確認 前半) */}
          <Section title="撤回できない点について">
            <Pressable
              onPress={() => setAgreed((a) => !a)}
              style={({ pressed }) => [styles.consentRow, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                {agreed ? (
                  <Svg width={12} height={12} viewBox="0 0 12 12">
                    <Line x1={2} y1={6.5} x2={5} y2={9.5} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
                    <Line x1={5} y1={9.5} x2={10} y2={3} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
                  </Svg>
                ) : null}
              </View>
              <Text style={styles.consentBody}>
                このクリップについて License NFT が 1 つでも発行された後は、 撤回はできません。 ステーキングを解除しても既発行のライセンスは永続します。 上記を理解しました。
              </Text>
            </Pressable>
          </Section>
        </ScrollView>

        {/* 実行ボタン (= sticky footer) */}
        <View style={styles.footer}>
          <Pressable
            onPress={onStakePress}
            disabled={!agreed || submitting}
            style={({ pressed }) => [
              styles.stakeBtn,
              !agreed && styles.stakeBtnDisabled,
              pressed && agreed && styles.stakeBtnPressed,
            ]}
          >
            <Text style={[styles.stakeBtnLabel, !agreed && styles.stakeBtnLabelDisabled]}>
              ステーキングする
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
              <Text style={styles.dialogTitle}>本当にステーキングしますか？</Text>
              <Text style={styles.dialogBody}>
                ステーキング後、 このクリップは AI 企業に対するライセンス販売の対象となります。 License NFT 発行後は撤回できません。
              </Text>
              <View style={styles.dialogActions}>
                <Pressable
                  onPress={() => setFinalConfirm(false)}
                  disabled={submitting}
                  style={({ pressed }) => [styles.dialogBtn, pressed && styles.dialogBtnPressed]}
                >
                  <Text style={styles.dialogBtnLabel}>キャンセル</Text>
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
                      実行する
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

/// サーバ生成のぼかし済 MP4 を再生。 まだ準備中 (= サーバ処理完了前) は撮影時 snapshot を見せる。
const BlurPreviewPlayer: React.FC<{
  videoUrl?: string;
  fallbackImageUri?: string;
}> = ({ videoUrl, fallbackImageUri }) => {
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
          <Text style={styles.previewPlaceholderText}>プレビュー動画を準備中…</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.previewVideoWrap, styles.previewPlaceholder]}>
      <Text style={styles.previewPlaceholderText}>プレビュー準備中</Text>
    </View>
  );
};

const QualityBreakdownDisplay: React.FC<{ breakdown: QualityBreakdown }> = ({ breakdown }) => {
  // 2026-05-27: 4 → 3 層 (= GTSAM 撤去) + Layer3 配点 55 → 65。
  // 詳細な指標は ClipDetailSheet 側で全部見せる。
  const rows: Array<{ label: string; ratio: number | null; raw?: string }> = [
    { label: '合計スコア', ratio: null, raw: `${breakdown.total} / 100` },
    {
      label: 'Layer 1 メタデータ',
      ratio: null,
      raw: breakdown.layer1 ? `${breakdown.layer1.score} / 20` : '—',
    },
    {
      label: 'Layer 2 フレーム解析',
      ratio: null,
      raw: breakdown.layer2 ? `${breakdown.layer2.score} / 15` : '—',
    },
    {
      label: 'Layer 3 VLM 採点',
      ratio: null,
      raw: breakdown.layer3 ? `${breakdown.layer3.score} / 65` : '—',
    },
  ];
  return (
    <View style={styles.breakdownList}>
      {rows.map((r) => (
        <View key={r.label} style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>{r.label}</Text>
          {r.raw ? (
            <Text style={styles.breakdownValue}>{r.raw}</Text>
          ) : r.ratio !== null ? (
            <View style={styles.breakdownRight}>
              <Text style={styles.breakdownValue}>{Math.round(r.ratio * 100)}%</Text>
              <View style={styles.breakdownBarTrack}>
                <View style={[styles.breakdownBarFill, { width: `${Math.min(100, r.ratio * 100)}%` }]} />
              </View>
            </View>
          ) : null}
        </View>
      ))}
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

  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.warnSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warn,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 4,
    borderWidth: 1.5, borderColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    marginTop: 2,
  },
  checkboxOn: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  consentBody: {
    flex: 1,
    ...typography.caption,
    color: colors.ink,
    lineHeight: 19,
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
