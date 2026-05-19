import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { Clip } from '../services/clipPipeline';
import { describeProcessingStep, processingStepIndex } from '../services/clipPipeline';
import { findTask, type TaskDef } from '../domain/taskCatalog';
import { colors, fonts, radii, shadows, spacing, typography } from '../theme';

// クリップカード。
//
// SPECS_JA §2.7 のクリップ状態機械の各状態を、 1 つのカード type で表示分岐する。
// 各状態に対応する右側の affordance:
//   - アップロード中:  進捗バー + キャンセル
//   - 処理中:          4 ステップの dot progress + 現在のステップ名
//   - 準備完了:        品質スコア + 「Stake」 CTA (= タップで詳細シート)
//   - ステーキング済み: ライセンス数 + 累計売上
//   - 不合格:          不合格理由 + 「削除」 「再試行」
//   - 処理エラー:      エラー文言 + 「再試行」 「削除」
//
// 視覚的階層 (= ユーザの注意を引く強さ):
//   準備完了 > 不合格 ≒ 処理エラー > 処理中 > アップロード中 > ステーキング済み
//
// 準備完了が一番目立つように、 emeraldFaint の地色 + emeraldDeep の枠を採用。
// 他の状態は paper / card の neutral 上で動作するように設計。

interface Props {
  clip: Clip;
  onOpenStake?: (clip: Clip) => void;
  onRemove?: (clip: Clip) => void;
  onRetry?: (clip: Clip) => void;
}

export const ClipCard: React.FC<Props> = ({ clip, onOpenStake, onRemove, onRetry }) => {
  const task = useMemo(() => findTask(clip.taskId), [clip.taskId]);

  switch (clip.state) {
    case 'uploading':
      return <UploadingCard clip={clip} task={task} onRemove={onRemove} />;
    case 'processing':
      return <ProcessingCard clip={clip} task={task} />;
    case 'ready':
      return <ReadyCard clip={clip} task={task} onOpenStake={onOpenStake} />;
    case 'staked':
      return <StakedCard clip={clip} task={task} />;
    case 'error':
      return <ErrorCard clip={clip} task={task} onRemove={onRemove} onRetry={onRetry} />;
  }
};

// ─── 共通要素 ──────────────────────────────────────────────────────────

const TaskThumb: React.FC<{ task: TaskDef | undefined; muted?: boolean }> = ({ task, muted }) => {
  if (!task) {
    return (
      <View style={[styles.thumb, muted && styles.thumbMuted]}>
        <Text style={styles.thumbFallback}>cNFT</Text>
      </View>
    );
  }
  return (
    <View style={[styles.thumb, muted && styles.thumbMuted]}>
      <Image source={task.illustration} style={styles.thumbImage} resizeMode="cover" />
    </View>
  );
};

const TaskName: React.FC<{ task: TaskDef | undefined; clip: Clip; mono?: boolean }> = ({ task, clip, mono }) => {
  if (mono || !task) {
    return (
      <Text style={[styles.cardName, !task && styles.cardNameMono]} numberOfLines={1}>
        {task?.name ?? `Clip ${clip.id.slice(-6)}`}
      </Text>
    );
  }
  return (
    <Text style={styles.cardName} numberOfLines={1}>
      {task.name}
    </Text>
  );
};

const formatTimestamp = (ts: number): string => {
  const d = new Date(ts);
  const sameDay = isSameDay(d, new Date());
  if (sameDay) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ─── アップロード中 ─────────────────────────────────────────────────────

const UploadingCard: React.FC<{ clip: Clip; task: TaskDef | undefined; onRemove?: (c: Clip) => void }> = ({
  clip, task, onRemove,
}) => {
  const progress = Math.max(0, Math.min(1, clip.uploadProgress ?? 0));
  return (
    <View style={styles.card}>
      <TaskThumb task={task} />
      <View style={styles.cardMid}>
        <TaskName clip={clip} task={task} />
        <Text style={styles.eyebrowMuted}>アップロード中 · {Math.round(progress * 100)}%</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
      <Pressable
        onPress={() => onRemove?.(clip)}
        hitSlop={8}
        style={({ pressed }) => [styles.cornerBtn, pressed && styles.cornerBtnPressed]}
        accessibilityLabel="キャンセル"
      >
        <Svg width={14} height={14} viewBox="0 0 14 14">
          <Line x1={3} y1={3} x2={11} y2={11} stroke={colors.textMute} strokeWidth={1.6} strokeLinecap="round" />
          <Line x1={11} y1={3} x2={3} y2={11} stroke={colors.textMute} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      </Pressable>
    </View>
  );
};

// ─── 処理中 ────────────────────────────────────────────────────────────

const ProcessingCard: React.FC<{ clip: Clip; task: TaskDef | undefined }> = ({ clip, task }) => {
  const stepIdx = processingStepIndex(clip.processingStep);  // 1..4
  const stepLabel = describeProcessingStep(clip.processingStep);
  // 現在ステップの dot を pulse
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.card}>
      <TaskThumb task={task} />
      <View style={styles.cardMid}>
        <TaskName clip={clip} task={task} />
        <Text style={styles.eyebrowMuted}>処理中 ({stepIdx}/4) · {stepLabel}</Text>
        <View style={styles.dotRow}>
          {[1, 2, 3, 4].map((i) => {
            const isDone = i < stepIdx;
            const isCurrent = i === stepIdx;
            return (
              <View key={i} style={styles.dotWrap}>
                {isCurrent ? (
                  <Animated.View
                    style={[
                      styles.dot,
                      styles.dotCurrent,
                      { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                    ]}
                  />
                ) : (
                  <View style={[styles.dot, isDone ? styles.dotDone : styles.dotPending]} />
                )}
                {i < 4 ? <View style={[styles.dotBar, isDone && styles.dotBarDone]} /> : null}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
};

// ─── 準備完了 (= action 要請、 視覚最強) ──────────────────────────────

const ReadyCard: React.FC<{ clip: Clip; task: TaskDef | undefined; onOpenStake?: (c: Clip) => void }> = ({
  clip, task, onOpenStake,
}) => {
  return (
    <Pressable
      onPress={() => onOpenStake?.(clip)}
      style={({ pressed }) => [styles.card, styles.cardReady, pressed && styles.cardReadyPressed]}
      accessibilityLabel={`${task?.name ?? 'クリップ'} をステーキングする`}
    >
      <TaskThumb task={task} />
      <View style={styles.cardMid}>
        <TaskName clip={clip} task={task} />
        <Text style={styles.eyebrowEmerald}>準備完了 · {formatTimestamp(clip.createdAt)}</Text>
        {typeof clip.qualityScore === 'number' && clip.reward ? (
          <Text style={styles.cardSub}>
            品質 {clip.qualityScore}  ·  ${clip.reward.rangeUsdcLow.toFixed(2)}〜${clip.reward.rangeUsdcHigh.toFixed(2)}
          </Text>
        ) : null}
      </View>
      <View style={styles.stakeCta}>
        <Text style={styles.stakeCtaLabel}>Stake</Text>
        <Svg width={12} height={12} viewBox="0 0 12 12">
          <Path d="M3 6h6m-2 -2 2 2 -2 2" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      </View>
    </Pressable>
  );
};

// ─── ステーキング済み ──────────────────────────────────────────────────

const StakedCard: React.FC<{ clip: Clip; task: TaskDef | undefined }> = ({ clip, task }) => {
  const onSolscan = () => {
    if (clip.rootAssetId) {
      Linking.openURL(`https://solscan.io/token/${clip.rootAssetId}?cluster=devnet`).catch(() => {});
    }
  };
  const licenseCount = clip.licenseCount ?? 0;
  const revenue = clip.revenueUsdc ?? 0;
  return (
    <Pressable
      onPress={onSolscan}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <TaskThumb task={task} />
      <View style={styles.cardMid}>
        <TaskName clip={clip} task={task} />
        <View style={styles.cardMeta}>
          <View style={[styles.statusChip, styles.statusChipStaked]}>
            <Text style={[styles.statusChipText, { color: colors.emeraldDeep }]}>STAKED</Text>
          </View>
          <Text style={styles.cardSub}>· {formatTimestamp(clip.createdAt)}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <View style={styles.statCol}>
          <Text style={styles.statColValue}>{licenseCount}</Text>
          <Text style={styles.statColLabel}>LIC</Text>
        </View>
        <View style={styles.statColSep} />
        <View style={styles.statCol}>
          <Text style={[styles.statColValue, revenue > 0 ? { color: colors.emeraldDeep } : { color: colors.textFaint }]}>
            ${revenue.toFixed(2)}
          </Text>
          <Text style={styles.statColLabel}>EARNED</Text>
        </View>
      </View>
    </Pressable>
  );
};

// ─── 処理エラー ────────────────────────────────────────────────────────

const ErrorCard: React.FC<{
  clip: Clip; task: TaskDef | undefined;
  onRemove?: (c: Clip) => void; onRetry?: (c: Clip) => void;
}> = ({ clip, task, onRemove, onRetry }) => {
  return (
    <View style={[styles.card, styles.cardMuted]}>
      <TaskThumb task={task} muted />
      <View style={styles.cardMid}>
        <TaskName clip={clip} task={task} />
        <Text style={styles.eyebrowDanger}>処理エラー</Text>
        <Text style={styles.cardSub} numberOfLines={2}>
          サーバ処理の再試行上限を超えました。 もう一度試すか、 サポートに連絡してください。
        </Text>
        <View style={styles.actionRow}>
          <SmallActionBtn label="削除" onPress={() => onRemove?.(clip)} />
          <SmallActionBtn label="もう一度試す" onPress={() => onRetry?.(clip)} accent />
        </View>
      </View>
    </View>
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

// ─── styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  cardPressed: { backgroundColor: colors.paperDeep },
  cardMuted: { backgroundColor: colors.paperDeep },

  cardReady: {
    backgroundColor: colors.emeraldFaint,
    borderColor: colors.borderEmerald,
  },
  cardReadyPressed: {
    backgroundColor: colors.emeraldSoft,
  },

  thumb: {
    width: 64,
    aspectRatio: 1,
    backgroundColor: colors.paperDeep,
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumbMuted: { opacity: 0.55 },
  thumbImage: { width: '100%', height: '100%' },
  thumbFallback: { ...typography.label, color: colors.textMute },

  cardMid: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    gap: 4,
  },
  cardName: {
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    color: colors.ink,
    letterSpacing: -0.1,
  },
  cardNameMono: {
    fontFamily: fonts.mono,
    fontSize: 13,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  cardSub: { ...typography.caption, color: colors.textMute },

  eyebrowMuted: {
    ...typography.labelSmall,
    color: colors.textMute,
    marginTop: 2,
  },
  eyebrowEmerald: {
    ...typography.labelSmall,
    color: colors.emeraldDeep,
    marginTop: 2,
  },
  eyebrowWarn: {
    ...typography.labelSmall,
    color: colors.warn,
    marginTop: 2,
  },
  eyebrowDanger: {
    ...typography.labelSmall,
    color: colors.danger,
    marginTop: 2,
  },

  // status chip (staked)
  statusChip: {
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radii.sm, borderWidth: 1,
  },
  statusChipStaked: { backgroundColor: colors.emeraldSoft, borderColor: colors.borderEmerald },
  statusChipText: { ...typography.labelSmall },

  // staked right column
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingRight: spacing.lg,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    gap: spacing.md,
  },
  statCol: { alignItems: 'center', minWidth: 50, gap: 2 },
  statColSep: { width: 1, height: 30, backgroundColor: colors.border },
  statColValue: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  statColLabel: { ...typography.labelSmall, color: colors.textMute },

  // upload progress
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

  // corner cancel
  cornerBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
    backgroundColor: colors.paperDeep,
    borderWidth: 1, borderColor: colors.border,
  },
  cornerBtnPressed: { backgroundColor: colors.borderLight },

  // processing dots
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingRight: spacing.md,
  },
  dotWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotDone: { backgroundColor: colors.emerald },
  dotCurrent: { backgroundColor: colors.emerald },
  dotPending: { backgroundColor: colors.borderLight },
  dotBar: { flex: 1, height: 1, backgroundColor: colors.borderLight, marginHorizontal: 4 },
  dotBarDone: { backgroundColor: colors.emerald },

  // ready: stake CTA pill
  stakeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.ink,
    borderRadius: radii.full,
    marginRight: spacing.md,
  },
  stakeCtaLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12, letterSpacing: 0.6,
    color: '#fff',
  },

  // small text-button actions (rejected / error)
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 8,
  },
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

// Suppress unused warning for shadows / typography re-export shape
void Circle;
