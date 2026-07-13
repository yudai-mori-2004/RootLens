// マイビデオ画面 — アップロード済み履歴 + アップロード待ち + 撮影時間の記録。
//
// 横持ち前提の「誌面」 レイアウト:
//   左 = 扉カラム: ロゴ + 日付 (上) / 合計撮影時間 (中央、 常時) / ミッション文 (下)
//   右上 = アップロード済み履歴 (= 小サムネの横スクロール)
//   右下 = アップロード待ちがあれば待ちリスト (横一列カード)、 なければ日別グラフ
//          (= 2026/6 まで横スクロールで遡れる)
//
// 合計撮影時間 = サーバの uploaded 済み durationMs 合算 (= GET /api/clips、 AsyncStorage に
// キャッシュしてオフラインでも即表示) + ローカルのアップロード待ち分。
// 履歴サムネは R2 の mp4 から range リクエストで 1 フレームだけ読む (services/clipFrames)。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
  Pressable,
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
import { HistoryDetailModal } from '../components/HistoryDetailModal';
import {
  storeEventSink, advanceClip, discardClip, fetchMyClips,
  type Clip, type ServerClipStatus,
} from '../dataflow';
import { useClips } from '../clips/hooks';
import { useUploadedClipFrame } from '../services/clipFrames';
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
          recordingConfigId: 'arkit', durationMs: 754_000,
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
          recordingConfigId: 'arkit', durationMs: 361_000, uploadProgress: 0.62,
        },
        thumb: require('../../assets/decor/celebration.png'),
      },
    ]
  : [];

/** 履歴のデザイン検証用モック (= アップロード済みタイル)。 */
const HISTORY_MOCKS: { clip: ServerClipStatus; source: ImageSourcePropType }[] = DESIGN_PREVIEW
  ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      clip: {
        contentHash: `hmock_${i}`,
        createdAt: new Date(Date.now() - (i + 1) * 86_400_000 * 1.3).toISOString(),
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

function todayLabel(nowMs: number): string {
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  const d = new Date(nowMs);
  const date = d.toLocaleDateString(tag, { month: 'long', day: 'numeric', weekday: 'long' });
  const time = d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
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

function formatGraphDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  return new Date(y, m - 1, d).toLocaleDateString(tag, { month: 'long', day: 'numeric' });
}

function historyDateLabel(iso: string | undefined): string {
  if (!iso) return '';
  const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
  const d = new Date(iso);
  const date = d.toLocaleDateString(tag, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
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
        const fresh = await fetchMyClips();
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

  // 扉カラムの時計 (= 30 秒ごとに更新)
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
  const historyScrollRef = React.useRef<ScrollView>(null);

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
  const [historyTarget, setHistoryTarget] = useState<{ clip: ServerClipStatus; source?: ImageSourcePropType } | null>(null);
  // グラフで選択中の日 (= バーtap)。 履歴の該当日タイルもハイライトされる。
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // 選択日が変わったら、 履歴ストリップを該当日の最初のタイルまで滑らかにスクロールする
  useEffect(() => {
    if (!selectedDay) return;
    const index = history.findIndex(
      (h) => h.clip.createdAt != null && dayKey(h.clip.createdAt) === selectedDay,
    );
    if (index < 0) return;
    historyScrollRef.current?.scrollTo({ x: index * HISTORY_TILE_PITCH, animated: true });
  }, [selectedDay, history]);
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
          <Text style={styles.date}>{todayLabel(nowMs)}</Text>
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
              ref={historyScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.historyRow}
            >
              {history.map(({ clip, source }) => (
                <HistoryTile
                  key={clip.contentHash}
                  clip={clip}
                  source={source}
                  selected={selectedDay != null && clip.createdAt != null && dayKey(clip.createdAt) === selectedDay}
                  onPress={() => setHistoryTarget({ clip, source })}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.bottomBlock}>
          {rows.length > 0 ? (
            <View style={styles.pendingBlock}>
              <Text style={styles.pendingNotice}>{t('portfolio.pendingNotice')}</Text>
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
            <GraphPanel daily={mergedDaily} totalMs={totalMs} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
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
      <HistoryDetailModal
        visible={historyTarget !== null}
        clip={historyTarget?.clip ?? null}
        thumbSource={historyTarget?.source}
        onClose={() => setHistoryTarget(null)}
      />
    </View>
  );
};

// ─── 履歴タイル (= 小サムネ + 日付) ─────────────────────────────────────

const HistoryTile: React.FC<{
  clip: ServerClipStatus;
  source?: ImageSourcePropType;
  selected?: boolean;
  onPress?: () => void;
}> = ({ clip, source, selected, onPress }) => {
  // サムネは R2 の mp4 から range リクエストで 1 フレームだけ読む (= 端末に動画は置かない)。
  const frame = useUploadedClipFrame(clip.contentHash, source ? null : clip.contentHash);
  const resolved = source ?? (frame ? { uri: frame } : undefined);
  return (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}>
    <View style={[styles.tileThumb, selected && styles.tileThumbSelected]}>
      {resolved ? (
        <Image source={resolved} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={styles.tileFallback}>
          <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
            <Circle cx={9} cy={9} r={8.2} stroke={colors.textFaint} strokeWidth={1.1} />
            <Polygon points="7,5.6 12.4,9 7,12.4" fill={colors.textFaint} />
          </Svg>
        </View>
      )}
    </View>
    <Text style={[styles.tileDate, selected && styles.tileDateSelected]} numberOfLines={1}>
      {historyDateLabel(clip.createdAt)}
    </Text>
  </Pressable>
  );
};

// ─── 日別グラフ (= アップロード待ちが無いときの下面。 2026/6 まで遡れる) ────────

const RECORD_EPOCH = new Date(2026, 5, 1).getTime(); // 2026-06-01

const GraphPanel: React.FC<{
  daily: Record<string, number>;
  totalMs: number;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}> = ({ daily, totalMs, selectedDay, onSelectDay }) => {
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

  const selected = selectedDay ? days.find((d) => d.key === selectedDay) ?? null : null;

  return (
    <View style={styles.graph}>
      <View style={styles.graphHeader}>
        <Text style={[styles.sectionLabel, styles.sectionLabelInline]}>{t('portfolio.dailyLabel')}</Text>
        {selected ? (
          <Text style={styles.graphReadout}>
            {formatGraphDate(selected.key)} · {formatTotal(selected.ms)}
          </Text>
        ) : null}
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chartScroll}
        contentContainerStyle={styles.chart}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {days.map((d) => {
          const isSelected = d.key === selectedDay;
          return (
            <Pressable
              key={d.key}
              style={styles.chartCol}
              onPress={() => onSelectDay(isSelected ? null : d.key)}
              hitSlop={{ top: 8, bottom: 0, left: 0, right: 0 }}
            >
              <View style={styles.chartTrack}>
                <View
                  style={[
                    styles.chartBar,
                    isSelected && styles.chartBarSelected,
                    { height: `${Math.max(d.ms > 0 ? 6 : 0, Math.round((d.ms / maxMs) * 100))}%` },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.chartDay,
                  d.monthLabel ? styles.chartMonth : null,
                  isSelected && styles.chartDaySelected,
                ]}
                numberOfLines={1}
              >
                {d.monthLabel ?? (isSelected ? String(d.dayNum) : d.dayNum % 5 === 0 ? String(d.dayNum) : '·')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {totalMs === 0 ? <Text style={styles.recordInvite}>{t('portfolio.recordInvite')}</Text> : null}
    </View>
  );
};

const ASIDE_WIDTH = 236;
const HISTORY_TILE_PITCH = 124 + 12; // tile width + historyRow gap
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
  tileDateSelected: { color: colors.emeraldDeep },
  tilePressed: { opacity: 0.7 },
  tileThumbSelected: { borderColor: colors.emerald, borderWidth: 2 },

  // 下段 (= 待ちリスト or グラフ)
  bottomBlock: { flex: 1 },
  pendingBlock: { flex: 1, justifyContent: 'center' },
  rowList: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    alignItems: 'center',
  },

  graph: { flex: 1, justifyContent: 'flex-end', paddingBottom: spacing.sm },
  graphHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingRight: spacing.xl,
  },
  sectionLabelInline: { marginBottom: spacing.sm },
  graphReadout: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: colors.ink,
  },
  pendingNotice: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14.5,
    color: colors.ink,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
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
  chartDay: { ...typography.labelSmall, fontSize: 9, letterSpacing: 0.4, color: colors.textFaint },
  chartMonth: { color: colors.textMute },
  chartBarSelected: { backgroundColor: colors.ink, opacity: 1 },
  chartDaySelected: { color: colors.ink },

  recordInvite: {
    ...typography.caption,
    color: colors.textBody,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
});
