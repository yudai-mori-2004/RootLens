// クリップ詳細シート (UI_SPECS §3.3 / §3.4)。
//
// Home タブのカードをタップすると開く。 ready / staked / error の状態別に内容を切替え、
// 品質スコアの 3 層内訳 + 自動分類カテゴリ + オンチェーン情報 + アクションを提示する。
//
// 2026-05-27 方針転換: 4 → 3 層 (= GTSAM 撤去)、 タスク事前選択撤去で TASK ブロックは
// autoCategory 表示に置換。
//
// デザイン方針:
//   ・ Bottom Sheet 風の modal (= 上部に handle bar、 背景は scrim)
//   ・ Editorial Fintech 美学 (= warm cream、 navy ink、 emerald accent)
//   ・ 各層の細指標は折り畳まず一覧表示 (= デバッグ + 改善学習用)

import React from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import type {
  AutoCategory,
  Clip,
  Layer1Score,
  Layer2Score,
  Layer3Score,
  QualityBreakdown,
} from '../services/clipPipeline';
import { findTask } from '../domain/taskCatalog';
import { colors, fonts, radii, spacing, typography } from '../theme';

interface Props {
  visible: boolean;
  clip: Clip | null;
  onClose: () => void;
  onOpenStake?: (clip: Clip) => void;
  onRemove?: (clip: Clip) => void;
}

export const ClipDetailSheet: React.FC<Props> = ({ visible, clip, onClose, onOpenStake, onRemove }) => {
  if (!clip) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.scrim} />
      </Modal>
    );
  }

  // 旧 taskId 持ち clip (= legacy persistence) の互換表示。 新撮影では undefined。
  const legacyTask = clip.taskId ? findTask(clip.taskId) : null;
  const breakdown = clip.qualityBreakdown ?? null;
  const total = breakdown?.total ?? clip.qualityScore ?? null;

  const onSolscan = () => {
    if (clip.rootAssetId) {
      Linking.openURL(`https://solscan.io/token/${clip.rootAssetId}?cluster=devnet`).catch(() => {});
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.handle} />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ヘッダ: VLM 自動分類 (= 新仕様) or legacy task name + 撮影日 */}
          <View style={styles.header}>
            <Text style={styles.taskName}>
              {clip.autoCategory ? describeAutoCategory(clip.autoCategory) : legacyTask?.name ?? clip.taskId ?? '未分類'}
            </Text>
            <Text style={styles.timestamp}>{formatDateTime(clip.createdAt)}</Text>
          </View>

          {/* 総合スコア (大型表示) */}
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreEyebrow}>QUALITY SCORE</Text>
            <View style={styles.scoreRow}>
              <Text style={[styles.scoreNumber, scoreTone(total)]}>
                {total === null ? '—' : String(total)}
              </Text>
              <Text style={styles.scoreOutOf}>/ 100</Text>
            </View>
          </View>

          {/* 3 層内訳 (= GTSAM 撤去後) */}
          {breakdown ? (
            <View style={styles.layersBlock}>
              <Text style={styles.sectionEyebrow}>BREAKDOWN</Text>
              <Layer1Card data={breakdown.layer1} />
              <Layer2Card data={breakdown.layer2} />
              <Layer3Card data={breakdown.layer3} />
            </View>
          ) : (
            <View style={styles.noScoreCard}>
              <Text style={styles.noScoreText}>
                {clip.state === 'processing'
                  ? 'まだ採点中です。'
                  : 'スコア内訳がありません。'}
              </Text>
            </View>
          )}

          {/* オンチェーン情報 (= rootAssetId 等) */}
          {clip.rootAssetId ? (
            <View style={styles.onchainBlock}>
              <Text style={styles.sectionEyebrow}>ON-CHAIN</Text>
              <Row label="ROOT ASSET" value={shortBase58(clip.rootAssetId)} onPress={onSolscan} mono />
              {clip.delegate ? <Row label="DELEGATE" value={shortBase58(clip.delegate)} mono /> : null}
              <Row label="LICENSES SOLD" value={String(clip.licenseCount ?? 0)} />
              <Row
                label="REVENUE"
                value={`$${(clip.revenueUsdc ?? 0).toFixed(2)} USDC`}
                tone={clip.revenueUsdc && clip.revenueUsdc > 0 ? 'ok' : undefined}
              />
            </View>
          ) : null}

          {/* 自動分類 (= 新仕様、 Pipeline 2 の VLM ラベル付け結果) */}
          {clip.autoCategory ? (
            <View style={styles.taskBlock}>
              <Text style={styles.sectionEyebrow}>AUTO LABEL</Text>
              <Row label="CATEGORY" value={describeAutoCategory(clip.autoCategory)} />
              {clip.autoCategoryConfidence !== undefined ? (
                <Row label="CONFIDENCE" value={`${Math.round(clip.autoCategoryConfidence * 100)}%`} />
              ) : null}
            </View>
          ) : legacyTask ? (
            // legacy: 旧 capture flow で taskId 持ちのクリップを互換表示
            <View style={styles.taskBlock}>
              <Text style={styles.sectionEyebrow}>LEGACY TASK</Text>
              <Row label="ID" value={legacyTask.id} mono />
              <Row label="INTENSITY" value={legacyTask.intensity} />
              <Row label="ORIENTATION" value={legacyTask.orientation} />
            </View>
          ) : null}

          {/* エラー表示 */}
          {clip.state === 'error' && clip.errorMessage ? (
            <View style={styles.errorBlock}>
              <Text style={styles.sectionEyebrow}>ERROR</Text>
              <Text style={styles.errorText} numberOfLines={6}>{clip.errorMessage}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* アクション (= 状態別) */}
        <View style={styles.actions}>
          {clip.state === 'ready' && onOpenStake ? (
            <ActionButton
              label="STAKE THIS CLIP"
              kind="primary"
              onPress={() => {
                onClose();
                onOpenStake(clip);
              }}
            />
          ) : null}
          {(clip.state === 'ready' || clip.state === 'error') && onRemove ? (
            <ActionButton
              label="DELETE"
              kind="ghost-danger"
              onPress={() => {
                onClose();
                onRemove(clip);
              }}
            />
          ) : null}
          <ActionButton label="CLOSE" kind="ghost" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// ─── レイヤカード ──────────────────────────────────────────────────

const Layer1Card: React.FC<{ data: Layer1Score | null }> = ({ data }) => (
  // 2026-05-27: ARKit 撤去で trackingQuality 行削除
  // 2026-05-28: IMU 撤去で imuGravityCompliance 行削除、 配点は handLandmarkPresenceBoth に振替
  <LayerCard title="Layer 1 · Metadata" max={20} data={data} renderRows={(d) => (
    <>
      <MetricRow label="Hand presence (both)" value={pctOrNa(d.handLandmarkPresenceBoth)} />
      <MetricRow label="RGB/Sensor sync" value={pctOrNa(d.rgbSensorSyncRatio)} />
      <MetricRow label="Frame continuity" value={pctOrNa(d.frameContinuity)} />
      <MetricRow label="Hand movement" value={pctOrNa(d.handMovement)} />
    </>
  )} />
);

const Layer2Card: React.FC<{ data: Layer2Score | null }> = ({ data }) => (
  <LayerCard title="Layer 2 · Frame sampling" max={15} data={data} renderRows={(d) => (
    <>
      <MetricRow label="Brightness in range" value={pctOrNa(d.brightnessInRangeRatio)} />
      <MetricRow label="Sharpness pass" value={pctOrNa(d.sharpnessPassRatio)} />
      <MetricRow label="Optical flow pass" value={pctOrNa(d.opticalFlowPassRatio)} />
      <MetricRow label="Frame diversity" value={pctOrNa(d.frameDiversity)} />
    </>
  )} />
);

const Layer3Card: React.FC<{ data: Layer3Score | null }> = ({ data }) => (
  // 2026-05-27: GTSAM 撤去で 55 → 65 点 + 配点を再分配
  <LayerCard title="Layer 3 · VLM semantic" max={65} data={data} renderRows={(d) => (
    <>
      <MetricRow label="Task activity (avg, 0-5)" value={d.taskActivityAvg.toFixed(2)} />
      <MetricRow label="Object interaction" value={d.objectInteractionAvg.toFixed(2)} />
      <MetricRow label="Scene match" value={d.sceneMatchAvg.toFixed(2)} />
      <MetricRow label="Authenticity" value={d.authenticityAvg.toFixed(2)} />
      <MetricRow label="Idle ratio" value={pctOrNa(d.idleRatio)} />
    </>
  )} />
);

interface LayerCardProps<T> {
  title: string;
  max: number;
  data: T | null;
  renderRows: (data: T) => React.ReactNode;
}

function LayerCard<T extends { score: number }>({ title, max, data, renderRows }: LayerCardProps<T>) {
  const score = data?.score ?? null;
  return (
    <View style={styles.layerCard}>
      <View style={styles.layerHeader}>
        <Text style={styles.layerTitle}>{title}</Text>
        <View style={styles.layerScoreRow}>
          <Text style={[styles.layerScore, scoreTone(score, max)]}>
            {score === null ? '—' : String(score)}
          </Text>
          <Text style={styles.layerScoreOutOf}>/ {max}</Text>
        </View>
      </View>
      {data ? <View style={styles.layerMetrics}>{renderRows(data)}</View> : null}
    </View>
  );
}

const MetricRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.metricRow}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{value}</Text>
  </View>
);

// ─── Generic Row + Action ──────────────────────────────────────────

const Row: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
  tone?: 'ok' | 'warn';
  onPress?: () => void;
}> = ({ label, value, mono, multiline, tone, onPress }) => {
  const valueColor =
    tone === 'ok' ? colors.emeraldDeep : tone === 'warn' ? colors.warn : colors.ink;
  const inner = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          mono && { fontFamily: fonts.mono, fontSize: 12 },
          { color: valueColor },
          onPress && styles.rowValueLink,
        ]}
        numberOfLines={multiline ? 3 : 2}
      >
        {value}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.rowPressed]}>
        {inner}
      </Pressable>
    );
  }
  return inner;
};

const ActionButton: React.FC<{
  label: string;
  kind: 'primary' | 'ghost' | 'ghost-danger';
  onPress: () => void;
}> = ({ label, kind, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.actionBtn,
      kind === 'primary' && styles.actionBtnPrimary,
      kind === 'ghost' && styles.actionBtnGhost,
      kind === 'ghost-danger' && styles.actionBtnGhostDanger,
      pressed && styles.actionBtnPressed,
    ]}
  >
    <Text
      style={[
        styles.actionLabel,
        kind === 'primary' && styles.actionLabelPrimary,
        kind === 'ghost' && styles.actionLabelGhost,
        kind === 'ghost-danger' && styles.actionLabelDanger,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

// ─── helpers ──────────────────────────────────────────────────────

function describeAutoCategory(c: AutoCategory): string {
  switch (c) {
    case 'cleaning':   return '掃除';
    case 'laundry':    return '洗濯';
    case 'cooking':    return '料理';
    case 'studying':   return '勉強';
    case 'crafting':   return '工作';
    case 'organizing': return '整理整頓';
    case 'meal_prep':  return '食事の支度';
    case 'other':      return 'その他';
  }
}

function pctOrNa(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

function shortBase58(s: string): string {
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scoreTone(score: number | null, max?: number) {
  if (score === null) return { color: colors.textFaint };
  const ratio = max ? score / max : score / 100;
  if (ratio >= 0.7) return { color: colors.emeraldDeep };
  if (ratio >= 0.4) return { color: colors.ink };
  return { color: colors.gold };
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(14,31,68,0.55)' },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    marginTop: 8,
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },

  header: { gap: 4 },
  taskName: {
    fontFamily: fonts.serifMedium,
    fontSize: 26,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  timestamp: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.textMute,
  },

  scoreBlock: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scoreEyebrow: { ...typography.label, color: colors.textMute },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
    gap: 6,
  },
  scoreNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 72,
    letterSpacing: -2,
    lineHeight: 78,
  },
  scoreOutOf: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.textMute,
  },

  sectionEyebrow: { ...typography.label, color: colors.textMute, marginBottom: spacing.sm },
  layersBlock: { gap: spacing.sm },
  noScoreCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  noScoreText: { ...typography.body, color: colors.textBody },

  layerCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  layerHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 6,
  },
  layerTitle: {
    fontFamily: fonts.serifMedium,
    fontSize: 14,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  layerScoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  layerScore: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  layerScoreOutOf: {
    fontFamily: fonts.sansSemibold,
    fontSize: 10,
    color: colors.textMute,
    letterSpacing: 0.5,
  },
  layerMetrics: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: 2,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 4,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMute,
    flex: 1,
  },
  metricValue: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink,
  },

  onchainBlock: { gap: 0 },
  taskBlock: { gap: 0 },
  errorBlock: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: 4,
  },
  errorText: { ...typography.caption, color: colors.danger, lineHeight: 16 },

  row: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  rowPressed: { opacity: 0.55 },
  rowLabel: { ...typography.labelSmall, color: colors.textMute },
  rowValue: { ...typography.body, color: colors.ink, fontSize: 14 },
  rowValueLink: { textDecorationLine: 'underline' },

  actions: {
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  actionBtn: {
    paddingVertical: 16,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  actionBtnPrimary: { backgroundColor: colors.ink },
  actionBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnGhostDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.dangerSoft,
  },
  actionBtnPressed: { opacity: 0.7 },
  actionLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 2,
  },
  actionLabelPrimary: { color: colors.textOnInk },
  actionLabelGhost: { color: colors.ink },
  actionLabelDanger: { color: colors.danger },
});
