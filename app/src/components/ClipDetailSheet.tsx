// クリップ詳細シート (UI_SPECS §3.3 / §3.4)。
//
// Home タブのカードをタップすると開く。 ready / staked / error / processing の状態別に内容を切替える。
//
// 画面設計 (= 主婦向けに整理。 旧版はスコア羅列が先頭でプレビュー無し・削除が出品と同格・
// 「オンチェーン/署名ハッシュ/Layer 英語指標」 が露出して分かりにくかった):
//   1. まずプレビュー (動画) を最上部に置く (= 最初に見たいのは評価でなく中身)
//   2. 品質スコアは簡潔に (大きい数字 + 一言)
//   3. 売れていれば「販売状況」を平易に (= 売れた数 / 収入)
//   4. Layer 内訳・rootAssetId・署名ハッシュ等の専門情報は「詳しい内訳」に畳む (既定で閉じる)
//   5. 主アクションは「出品する」 1 つ。 削除は小さな文字リンクに格下げ。 閉じるは scrim タップ。

import React, { useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import Svg, { Path } from 'react-native-svg';

import type {
  Clip,
  Layer1Score,
  Layer2Score,
  Layer3Score,
} from '../dataflow';
import { clipTitle } from '../domain/clipLabels';
import { useT } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';

interface Props {
  visible: boolean;
  clip: Clip | null;
  onClose: () => void;
  onOpenStake?: (clip: Clip) => void;
  onRemove?: (clip: Clip) => void;
}

export const ClipDetailSheet: React.FC<Props> = ({ visible, clip, onClose, onOpenStake, onRemove }) => {
  const t = useT();
  const [showDetails, setShowDetails] = useState(false);

  if (!clip) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.scrim} />
      </Modal>
    );
  }

  const breakdown = clip.qualityBreakdown ?? null;
  const total = breakdown?.total ?? clip.qualityScore ?? null;
  const hasSales = clip.state === 'staked' || (clip.licenseCount ?? 0) > 0 || (clip.revenueUsdc ?? 0) > 0;

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
          {/* 1. プレビュー (最上部) */}
          <PreviewPlayer clip={clip} />

          {/* 2. タイトル + 撮影日時 */}
          <View style={styles.header}>
            <Text style={styles.taskName} numberOfLines={2} ellipsizeMode="tail">
              {clipTitle(clip)}
            </Text>
            <Text style={styles.timestamp}>{formatDateTime(clip.createdAt)}</Text>
          </View>

          {/* 3. 品質スコア (簡潔) */}
          {total !== null ? (
            <View style={styles.scoreBlock}>
              <View style={styles.scoreRow}>
                <Text style={[styles.scoreNumber, scoreTone(total)]}>{String(total)}</Text>
                <Text style={styles.scoreOutOf}>/ 100</Text>
              </View>
              <Text style={styles.scoreHint}>{t('detail.scoreHint')}</Text>
            </View>
          ) : (
            <View style={styles.noScoreCard}>
              <Text style={styles.noScoreText}>
                {clip.state === 'processing' ? t('detail.scoringInProgress') : t('detail.noBreakdown')}
              </Text>
            </View>
          )}

          {/* 4. 販売状況 (= 売れている時だけ、 平易に) */}
          {hasSales ? (
            <View style={styles.salesBlock}>
              <Text style={styles.sectionEyebrow}>{t('detail.sales')}</Text>
              <Row label={t('detail.licensesSold')} value={String(clip.licenseCount ?? 0)} />
              <Row
                label={t('detail.revenue')}
                value={`$${(clip.revenueUsdc ?? 0).toFixed(2)}`}
                tone={clip.revenueUsdc && clip.revenueUsdc > 0 ? 'ok' : undefined}
              />
            </View>
          ) : null}

          {/* エラー */}
          {clip.state === 'error' && clip.errorMessage ? (
            <View style={styles.errorBlock}>
              <Text style={styles.sectionEyebrow}>{t('detail.error')}</Text>
              <Text style={styles.errorText} numberOfLines={6}>{clip.errorMessage}</Text>
            </View>
          ) : null}

          {/* 5. 詳しい内訳 (= 専門情報は畳む) */}
          {breakdown || clip.rootAssetId || clip.signatureHash ? (
            <View>
              <Pressable
                onPress={() => setShowDetails((v) => !v)}
                style={({ pressed }) => [styles.detailsToggle, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.detailsToggleLabel}>{t('detail.showDetails')}</Text>
                <Chevron open={showDetails} />
              </Pressable>

              {showDetails ? (
                <View style={styles.detailsBody}>
                  {breakdown ? (
                    <>
                      <Layer1Card data={breakdown.layer1} />
                      <Layer2Card data={breakdown.layer2} />
                      <Layer3Card data={breakdown.layer3} />
                    </>
                  ) : null}
                  {clip.rootAssetId ? (
                    <View style={styles.techBlock}>
                      <Row label={t('detail.rootAsset')} value={shortBase58(clip.rootAssetId)} onPress={onSolscan} mono />
                      {clip.delegate ? <Row label={t('detail.delegate')} value={shortBase58(clip.delegate)} mono /> : null}
                    </View>
                  ) : null}
                  {clip.signatureHash ? (
                    <View style={styles.techBlock}>
                      <Row label={t('detail.signatureHash')} value={clip.signatureHash} mono multiline />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* アクション: 出品が主役、 削除は小さな文字リンク */}
        <View style={styles.actions}>
          {clip.state === 'ready' && onOpenStake ? (
            <Pressable
              onPress={() => { onClose(); onOpenStake(clip); }}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            >
              <Text style={styles.primaryLabel}>{t('detail.stakeThisClip')}</Text>
            </Pressable>
          ) : null}
          {(clip.state === 'ready' || clip.state === 'error') && onRemove ? (
            <Pressable
              onPress={() => { onClose(); onRemove(clip); }}
              hitSlop={8}
              style={({ pressed }) => [styles.deleteLink, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.deleteLinkText}>{t('detail.deleteThis')}</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

// ─── プレビュー ────────────────────────────────────────────────────
const PreviewPlayer: React.FC<{ clip: Clip }> = ({ clip }) => {
  const t = useT();
  const videoUrl = clip.previewVideoUrl;
  const fallback = clip.previewUris?.[0];
  if (videoUrl) {
    return (
      <View style={styles.previewWrap}>
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
  if (fallback) {
    return (
      <View style={styles.previewWrap}>
        <Image source={{ uri: fallback }} style={styles.previewVideo} resizeMode="contain" />
        <View style={styles.previewOverlay}>
          <Text style={styles.previewPlaceholderText}>{t('stake.previewPreparing')}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.previewWrap, styles.previewPlaceholder]}>
      <Text style={styles.previewPlaceholderText}>{t('stake.previewNotReady')}</Text>
    </View>
  );
};

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <Svg width={14} height={14} viewBox="0 0 14 14" style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
    <Path d="M5 3 l4 4 l-4 4" stroke={colors.textMute} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>
);

// ─── レイヤカード (= 詳しい内訳の中身。 デバッグ + 改善学習用) ─────────────

const Layer1Card: React.FC<{ data: Layer1Score | null }> = ({ data }) => (
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

// ─── helpers ──────────────────────────────────────────────────────

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
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },

  // プレビュー
  previewWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgInk,
    position: 'relative',
  },
  previewVideo: { width: '100%', height: '100%' },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,18,38,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  previewPlaceholderText: { ...typography.caption, color: '#fff' },

  header: { gap: 4 },
  taskName: {
    fontFamily: fonts.serifMedium,
    fontSize: 24,
    letterSpacing: -0.4,
    color: colors.ink,
    lineHeight: 30,
  },
  timestamp: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.textMute,
  },

  scoreBlock: { gap: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  scoreNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 52,
    letterSpacing: -1.5,
    lineHeight: 56,
  },
  scoreOutOf: { fontFamily: fonts.sansSemibold, fontSize: 14, color: colors.textMute },
  scoreHint: { ...typography.caption, color: colors.textMute },

  sectionEyebrow: { ...typography.label, color: colors.textMute, marginBottom: spacing.sm },

  salesBlock: { gap: 0 },

  noScoreCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  noScoreText: { ...typography.body, color: colors.textBody },

  // 詳しい内訳トグル
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  detailsToggleLabel: { ...typography.label, color: colors.textMute },
  detailsBody: { gap: spacing.sm, marginTop: spacing.md },
  techBlock: { gap: 0 },

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
  layerTitle: { fontFamily: fonts.serifMedium, fontSize: 14, color: colors.ink, letterSpacing: -0.1 },
  layerScoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  layerScore: { fontFamily: fonts.serifMedium, fontSize: 18, letterSpacing: -0.3 },
  layerScoreOutOf: { fontFamily: fonts.sansSemibold, fontSize: 10, color: colors.textMute, letterSpacing: 0.5 },
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
  metricLabel: { ...typography.caption, color: colors.textMute, flex: 1 },
  metricValue: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink },

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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  primaryBtn: {
    paddingVertical: 16,
    borderRadius: radii.md,
    alignItems: 'center',
    backgroundColor: colors.ink,
  },
  primaryBtnPressed: { backgroundColor: colors.inkSoft },
  primaryLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.textOnInk,
  },
  deleteLink: { alignSelf: 'center', paddingVertical: spacing.sm },
  deleteLinkText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.danger,
  },
});
