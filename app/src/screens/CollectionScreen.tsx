// マイビデオ画面 (v0.1.4) — アップロード済み履歴 + アップロード待ち + 撮影時間の記録。
//
// 横持ち前提の「誌面」 レイアウト:
//   左 = 扉カラム: ロゴ + 日付 (上) / 合計撮影時間 (中央、 常時) / ミッション文 (下)
//   右上 = アップロード済み履歴 (= 小サムネの横スクロール。 端末に残したサムネで全部見返せる)
//   右下 = アップロード待ちがあれば待ちリスト (横一列カード)、 なければ日別グラフ
//          (= 2026/6 まで横スクロールで遡れる)
//
// 合計撮影時間 = サーバの uploaded 済み durationMs 合算 (= GET /api/clips、 AsyncStorage に
// キャッシュしてオフラインでも即表示) + ローカルのアップロード待ち分。
// 履歴サムネはアップロード完了時に端末へ永続化した jpg (= dataflow steps/thumbs)。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Polygon } from 'react-native-svg';

import { BrandMark } from '../components/BrandMark';
import { ClipCard, type DesignMock } from '../components/ClipCard';
import { ClipPreviewModal } from '../components/ClipPreviewModal';
import {
  storeEventSink, advanceClip, discardClip, fetchMyClips, thumbPath, listThumbHashes,
  type Clip, type ServerClipStatus,
} from '../dataflow';
import { useClips } from '../clips/hooks';
import { getCurrentSession } from '../services/auth/instance';
import { useT, getLocale } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';

// ─── デザイン検証用モック (= __DEV__ のみ。 store / 永続化を汚さず表示だけ) ──
const DESIGN_PREVIEW = __DEV__ && false;
const MOCK_STATS = DESIGN_PREVIEW;

const MOCKS: DesignMock[] = DESIGN_PREVIEW
  ? [
      {
        clip: {
          id: 'mock_1', state: 'recorded', createdAt: Date.now() - 8 * 60_000,
          recordingConfigId: 'ultra_wide', durationMs: 754_000,
        },
        thumb: require('../../assets/decor/home-warm.png'),
      },
      {
        clip: {
          id: 'mock_5', state: 'error', createdAt: Date.now() - 50 * 60_000,
          recordingConfigId: 'arkit', durationMs: 233_000,
          errorMessage: 'アップロードに失敗しました。電波の良いところでもう一度お試しください。',
        },
        thumb: require('../../assets/decor/home-banner.png'),
      },
      {
        clip: {
          id: 'mock_3', state: 'uploading', createdAt: Date.now() - 3 * 60_000,
          recordingConfigId: 'ultra_wide', durationMs: 361_000, uploadProgress: 0.62,
        },
        thumb: require('../../assets/decor/celebration.png'),
      },
    ]
  : [];

/** 履歴のデザイン検証用モック (= アップロード済みタイル)。 */
const HISTORY_MOCKS: { clip: ServerClipStatus; source: ImageSourcePropType }[] = DESIGN_PREVIEW
  ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      clip: {
        id: `hmock_${i}`,
        state: 'uploaded' as const,
        createdAt: new Date(Date.now() - (i + 1) * 86_400_000 * 1.3).toISOString(),
        signatureHash: `hmock_${i}`,
        durationMs: ((i * 97) % 40 + 3) * 60_000,
      },
      source: [
        require('../../assets/decor/home-warm.png'),
        require('../../assets/decor/step-storage.png'),
        require('../../assets/decor/celebration.png'),
        require('../../assets/decor/earnings-stack.png'),
        require('../../assets/decor/home-banner.png'),
        require('../../assets/decor/handshake.png'),
        require('../../assets/decor/auto-sales.png'),
        require('../../assets/decor/license-cert.png'),
      ][i % 8],
    }))
  : [];

function todayLabel(): string {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  return new Date().toLocaleDateString(tag, { month: 'long', day: 'numeric', weekday: 'long' });
}

/** 合計時間の人向け表記 (= 1 時間未満は分のみ)。 */
function formatTotal(ms: number): string {
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (getLocale() === 'en') {
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  if (h > 0) return `${h}時間${m}分`;
  return `${m}分`;
}

function historyDateLabel(iso: string | undefined): string {
  if (!iso) return '';
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  return new Date(iso).toLocaleDateString(tag, { month: 'short', day: 'numeric' });
}

// ─── サーバのクリップ一覧 (= 履歴 + 統計の元データ) ─────────────────────
// AsyncStorage にキャッシュしてオフラインでも即表示。 バックグラウンドで更新する。

const CLIPS_CACHE_KEY = '@rootlens/server-clips/v1';

function useServerClips(localUploadedCount: number): ServerClipStatus[] {
  const [clips, setClips] = useState<ServerClipStatus[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CLIPS_CACHE_KEY);
        if (raw && !cancelled) setClips(JSON.parse(raw) as ServerClipStatus[]);
      } catch {}
      try {
        const session = getCurrentSession();
        if (!session) return;
        const fresh = await fetchMyClips(session.pubkey);
        if (cancelled) return;
        setClips(fresh);
        AsyncStorage.setItem(CLIPS_CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
      } catch {}
    })();
    return () => { cancelled = true; };
    // アップロード完了のタイミングで再取得する
  }, [localUploadedCount]);

  return clips;
}

/** 端末に永続化済みのサムネ hash 集合 (= 履歴タイルの画像有無)。 */
function useThumbIndex(localUploadedCount: number): Set<string> {
  const [hashes, setHashes] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    listThumbHashes().then((s) => { if (!cancelled) setHashes(s); });
    return () => { cancelled = true; };
  }, [localUploadedCount]);
  return hashes;
}

const DAY_MS = 86_400_000;

function dayKey(iso: string | number): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

interface Row {
  clip: Clip;
  thumb?: DesignMock['thumb'];
}

export const CollectionScreen: React.FC = () => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const allClips = useClips();

  // アップロード待ち (= recorded / uploading / error)。 uploaded は履歴側に出る。
  const rows = useMemo<Row[]>(() => {
    const real: Row[] = allClips
      .filter((c) => c.state !== 'uploaded')
      .map((c) => ({ clip: c }));
    return [...real, ...MOCKS.map((m) => ({ clip: m.clip as Clip, thumb: m.thumb }))];
  }, [allClips]);

  const localUploadedCount = useMemo(
    () => allClips.filter((c) => c.state === 'uploaded').length,
    [allClips],
  );

  const serverClips = useServerClips(localUploadedCount);
  const thumbHashes = useThumbIndex(localUploadedCount);

  // 履歴 (= uploaded 済み、 新しい順 = サーバ返却順)。 モックは先頭に足す。
  const history = useMemo(
    () => [
      ...HISTORY_MOCKS.map((m) => ({ clip: m.clip, source: m.source as ImageSourcePropType | undefined })),
      ...serverClips.map((c) => ({ clip: c, source: undefined as ImageSourcePropType | undefined })),
    ],
    [serverClips],
  );

  // 合計撮影時間 = サーバ uploaded 分 + ローカル待ち分
  const uploadedTotalMs = useMemo(
    () => serverClips.reduce((sum, c) => sum + (c.durationMs ?? 0), 0),
    [serverClips],
  );
  const pendingMs = useMemo(
    () => rows.reduce((sum, r) => sum + (r.clip.durationMs ?? 0), 0),
    [rows],
  );
  const totalMs = (MOCK_STATS ? 11_460_000 : uploadedTotalMs) + pendingMs;

  // 日別グラフ用: サーバ uploaded 分にローカル待ち分も足す
  const mergedDaily = useMemo(() => {
    const d: Record<string, number> = {};
    for (const c of serverClips) {
      const ms = c.durationMs ?? 0;
      if (ms <= 0 || !c.createdAt) continue;
      const k = dayKey(c.createdAt);
      d[k] = (d[k] ?? 0) + ms;
    }
    for (const r of rows) {
      const ms = r.clip.durationMs ?? 0;
      if (ms <= 0) continue;
      const k = dayKey(r.clip.createdAt);
      d[k] = (d[k] ?? 0) + ms;
    }
    return d;
  }, [serverClips, rows]);

  const [previewTarget, setPreviewTarget] = useState<Clip | null>(null);
  const onOpen = useCallback((clip: Clip) => setPreviewTarget(clip), []);
  const onClose = useCallback(() => setPreviewTarget(null), []);
  const onUpload = useCallback((clip: Clip) => {
    setPreviewTarget(null);
    void advanceClip(clip.id, storeEventSink);
  }, []);
  const onRemove = useCallback((clip: Clip) => {
    setPreviewTarget(null);
    void discardClip(clip.id);
  }, []);

  return (
    <View style={[styles.root, { paddingLeft: insets.left }]}>
      {/* ── 左: 扉カラム ── */}
      <View style={styles.aside}>
        <View style={styles.asideHead}>
          <BrandMark size={30} />
          <Text style={styles.date}>{todayLabel()}</Text>
        </View>

        {/* 中央: 合計撮影時間 (= 常時表示) */}
        <View style={styles.counter}>
          <Text style={styles.counterNumber}>{formatTotal(totalMs)}</Text>
          <Text style={styles.counterLabel}>{t('portfolio.totalTime')}</Text>
        </View>

        <Text style={styles.mission}>{t('portfolio.mission')}</Text>
      </View>

      {/* ── 右: 履歴 (上) + 待ち or グラフ (下) ── */}
      <View style={styles.main}>
        {history.length > 0 ? (
          <View>
            <Text style={styles.sectionLabel}>{t('portfolio.uploadedLabel')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyRow}
            >
              {history.map(({ clip, source }) => (
                <HistoryTile
                  key={clip.id}
                  clip={clip}
                  source={
                    source ??
                    (clip.signatureHash && thumbHashes.has(clip.signatureHash)
                      ? { uri: thumbPath(clip.signatureHash) }
                      : undefined)
                  }
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.bottomBlock}>
          {rows.length > 0 ? (
            <View style={styles.pendingBlock}>
              <Text style={styles.sectionLabel}>{t('clip.recorded')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rowList}
              >
                {rows.map((item) => (
                  <ClipCard
                    key={item.clip.id}
                    clip={item.clip}
                    width={CARD_WIDTH}
                    previewSource={item.thumb}
                    onOpen={onOpen}
                  />
                ))}
              </ScrollView>
            </View>
          ) : (
            <GraphPanel daily={mergedDaily} totalMs={totalMs} />
          )}
        </View>
      </View>

      <ClipPreviewModal
        visible={previewTarget !== null}
        clip={previewTarget}
        onClose={onClose}
        onUpload={onUpload}
        onRemove={onRemove}
      />
    </View>
  );
};

// ─── 履歴タイル (= 小サムネ + 日付) ─────────────────────────────────────

const HistoryTile: React.FC<{ clip: ServerClipStatus; source?: ImageSourcePropType }> = ({
  clip, source,
}) => (
  <View style={styles.tile}>
    <View style={styles.tileThumb}>
      {source ? (
        <Image source={source} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={styles.tileFallback}>
          <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
            <Circle cx={9} cy={9} r={8.2} stroke={colors.textFaint} strokeWidth={1.1} />
            <Polygon points="7,5.6 12.4,9 7,12.4" fill={colors.textFaint} />
          </Svg>
        </View>
      )}
    </View>
    <Text style={styles.tileDate} numberOfLines={1}>{historyDateLabel(clip.createdAt)}</Text>
  </View>
);

// ─── 日別グラフ (= アップロード待ちが無いときの下面。 2026/6 まで遡れる) ────────

const RECORD_EPOCH = new Date(2026, 5, 1).getTime(); // 2026-06-01

const GraphPanel: React.FC<{ daily: Record<string, number>; totalMs: number }> = ({
  daily, totalMs,
}) => {
  const t = useT();
  const scrollRef = React.useRef<ScrollView>(null);

  const days = useMemo(() => {
    const out: { key: string; dayNum: number; monthLabel: string | null; ms: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let ts = RECORD_EPOCH; ts <= today.getTime(); ts += DAY_MS) {
      const d = new Date(ts);
      const k = dayKey(ts);
      const mockMs = MOCK_STATS ? ((d.getDate() * 7 + d.getMonth() * 3) % 9 === 0 ? 0 : ((d.getDate() * 13) % 70) * 60_000) : 0;
      out.push({
        key: k,
        dayNum: d.getDate(),
        monthLabel: d.getDate() === 1 || ts === RECORD_EPOCH ? `${d.getMonth() + 1}月` : null,
        ms: (daily[k] ?? 0) + mockMs,
      });
    }
    return out;
  }, [daily]);

  const maxMs = Math.max(...days.map((d) => d.ms), 1);

  return (
    <View style={styles.graph}>
      <Text style={styles.sectionLabel}>{t('portfolio.dailyLabel')}</Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chartScroll}
        contentContainerStyle={styles.chart}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {days.map((d) => (
          <View key={d.key} style={styles.chartCol}>
            <View style={styles.chartTrack}>
              <View
                style={[
                  styles.chartBar,
                  { height: `${Math.max(d.ms > 0 ? 6 : 0, Math.round((d.ms / maxMs) * 100))}%` },
                ]}
              />
            </View>
            <Text style={[styles.chartDay, d.monthLabel ? styles.chartMonth : null]} numberOfLines={1}>
              {d.monthLabel ?? (d.dayNum % 5 === 0 ? String(d.dayNum) : '·')}
            </Text>
          </View>
        ))}
      </ScrollView>
      {totalMs === 0 ? <Text style={styles.recordInvite}>{t('portfolio.recordInvite')}</Text> : null}
    </View>
  );
};

const ASIDE_WIDTH = 236;
const CARD_WIDTH = 260;

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.paper },

  aside: {
    width: ASIDE_WIDTH,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    justifyContent: 'space-between',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  asideHead: { gap: spacing.md },
  date: {
    ...typography.labelSmall,
    color: colors.textMute,
  },
  counter: { gap: 2 },
  counterNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: -1,
    color: colors.ink,
  },
  counterLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
  },
  mission: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 19,
    color: colors.textBody,
  },

  // ── 右面 ──
  main: {
    flex: 1,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  sectionLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },

  // 履歴 (= 上段)
  historyRow: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  tile: { width: 124 },
  tileThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.paperDeep,
  },
  tileImage: { width: '100%', height: '100%' },
  tileFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileDate: {
    ...typography.labelSmall,
    fontSize: 9.5,
    color: colors.textMute,
    marginTop: 4,
    paddingHorizontal: 1,
  },

  // 下段 (= 待ちリスト or グラフ)
  bottomBlock: { flex: 1 },
  pendingBlock: { flex: 1, justifyContent: 'center' },
  rowList: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    alignItems: 'center',
  },

  graph: { flex: 1, justifyContent: 'flex-end', paddingBottom: spacing.sm },
  chartScroll: { flexGrow: 0 },
  chart: {
    alignItems: 'flex-end',
    gap: 7,
    height: 150,
    paddingHorizontal: spacing.xl,
  },
  chartCol: { width: 22, alignItems: 'center', gap: 6, height: '100%' },
  chartTrack: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chartBar: {
    width: '100%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: colors.emerald,
    opacity: 0.85,
  },
  chartDay: { ...typography.labelSmall, fontSize: 9, color: colors.textFaint },
  chartMonth: { color: colors.textMute },

  recordInvite: {
    ...typography.caption,
    color: colors.textBody,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
});
