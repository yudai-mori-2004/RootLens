// マイビデオ画面 (v0.1.4) — 撮影済み・アップロード待ちクリップの一覧 + 撮影時間の記録。
//
// 横持ち前提の「誌面」 レイアウト:
//   左 = 固定の扉カラム (日付 / あいさつ / RootLens ロゴ + ミッション文 / 合計撮影時間)
//   右 = アップロード待ちがあれば 写真主体のカードグリッド、
//        なければ 撮影時間の記録パネル (= 大きな合計時間 + 直近 7 日のバー)。
//        「待ちが無い」 ことをわざわざ伝えない (= 記録を見せる方が前向き)。
//
// 合計撮影時間 = サーバの uploaded 済み durationMs 合算 (= GET /api/clips、 AsyncStorage に
// キャッシュしてオフラインでも即表示) + ローカルのアップロード待ち分。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BrandMark } from '../components/BrandMark';
import { ClipCard, type DesignMock } from '../components/ClipCard';
import { ClipPreviewModal } from '../components/ClipPreviewModal';
import {
  storeEventSink, advanceClip, discardClip, fetchMyClips,
  type Clip, type ServerClipStatus,
} from '../dataflow';
import { useClips } from '../clips/hooks';
import { getCurrentSession } from '../services/auth/instance';
import { useT, getLocale, type TranslationKey } from '../i18n';
import { colors, fonts, spacing, typography } from '../theme';

// ─── デザイン検証用モック (= __DEV__ のみ。 store / 永続化を汚さず表示だけ) ──
const DESIGN_PREVIEW = __DEV__ && false;

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
      {
        clip: {
          id: 'mock_4', state: 'uploading', createdAt: Date.now() - 2 * 60_000,
          recordingConfigId: 'ultra_wide', durationMs: 45_000, uploadProgress: 0,
        },
        thumb: require('../../assets/decor/earnings-stack.png'),
      },
    ]
  : [];

// デザイン検証用の記録モック (= 空状態の記録パネルにバーを立てる)。
const MOCK_STATS = DESIGN_PREVIEW;

function greetingKeyForNow(): TranslationKey {
  const h = new Date().getHours();
  if (h < 5) return 'portfolio.greetingNight';
  if (h < 11) return 'portfolio.greetingMorning';
  if (h < 17) return 'portfolio.greetingDay';
  if (h < 23) return 'portfolio.greetingEvening';
  return 'portfolio.greetingNight';
}

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

// ─── サーバ統計 (= uploaded 済みの撮影時間) ─────────────────────────────
// AsyncStorage にキャッシュしてオフラインでも即表示。 バックグラウンドで更新する。

const STATS_CACHE_KEY = '@rootlens/stats/v1';

interface UploadedStats {
  totalMs: number;
  /** YYYY-MM-DD → その日に撮影された uploaded 済み合計 (ms) */
  daily: Record<string, number>;
}

function dayKey(iso: string | number): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function statsFromServerClips(clips: ServerClipStatus[]): UploadedStats {
  const daily: Record<string, number> = {};
  let totalMs = 0;
  for (const c of clips) {
    const ms = c.durationMs ?? 0;
    if (ms <= 0) continue;
    totalMs += ms;
    if (c.createdAt) {
      const k = dayKey(c.createdAt);
      daily[k] = (daily[k] ?? 0) + ms;
    }
  }
  return { totalMs, daily };
}

function useUploadedStats(localUploadedCount: number): UploadedStats {
  const [stats, setStats] = useState<UploadedStats>({ totalMs: 0, daily: {} });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. キャッシュを即反映
      try {
        const raw = await AsyncStorage.getItem(STATS_CACHE_KEY);
        if (raw && !cancelled) setStats(JSON.parse(raw) as UploadedStats);
      } catch {}
      // 2. サーバから更新 (= 失敗してもキャッシュ表示のまま)
      try {
        const session = getCurrentSession();
        if (!session) return;
        const clips = await fetchMyClips(session.pubkey);
        if (cancelled) return;
        const fresh = statsFromServerClips(clips);
        setStats(fresh);
        AsyncStorage.setItem(STATS_CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
      } catch {}
    })();
    return () => { cancelled = true; };
    // localUploadedCount が増えた (= アップロード完了した) タイミングでも再取得する
  }, [localUploadedCount]);

  return stats;
}

interface Row {
  clip: Clip;
  thumb?: DesignMock['thumb'];
}

export const CollectionScreen: React.FC = () => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const allClips = useClips();

  // アップロード完了 (= uploaded) は一覧に出さない。 recorded / uploading / error が並ぶ。
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

  // 合計撮影時間 = サーバ uploaded 分 + ローカル待ち分
  const uploaded = useUploadedStats(localUploadedCount);
  const pendingMs = useMemo(
    () => rows.reduce((sum, r) => sum + (r.clip.durationMs ?? 0), 0),
    [rows],
  );
  const totalMs = (MOCK_STATS ? 11_460_000 : uploaded.totalMs) + pendingMs;

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
  const onRetry = useCallback((clip: Clip) => { void advanceClip(clip.id, storeEventSink); }, []);

  return (
    <View style={[styles.root, { paddingLeft: insets.left }]}>
      {/* ── 左: 扉カラム ── */}
      <View style={styles.aside}>
        <View>
          <Text style={styles.date}>{todayLabel()}</Text>
          <Text style={styles.greeting}>{t(greetingKeyForNow())}</Text>
        </View>

        <View style={styles.asideFoot}>
          <BrandMark size={18} />
          <Text style={styles.mission}>{t('portfolio.mission')}</Text>
          {rows.length > 0 ? (
            <>
              <View style={styles.rule} />
              <Text style={styles.counterNumber}>{formatTotal(totalMs)}</Text>
              <Text style={styles.counterLabel}>{t('portfolio.totalTime')}</Text>
            </>
          ) : null}
        </View>
      </View>

      {/* ── 右: 待ちがあればカードグリッド、 なければ記録パネル ── */}
      {rows.length === 0 ? (
        <RecordPanel totalMs={totalMs} daily={uploaded.daily} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.clip.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={11}
          renderItem={({ item }) => (
            <View style={styles.itemWrap}>
              <ClipCard
                clip={item.clip}
                previewSource={item.thumb}
                onOpen={onOpen}
                onRemove={onRemove}
                onRetry={onRetry}
              />
            </View>
          )}
        />
      )}

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

// ─── 撮影時間の記録パネル (= アップロード待ちが無いときの右面) ──────────────

const DAY_MS = 86_400_000;

const RecordPanel: React.FC<{ totalMs: number; daily: Record<string, number> }> = ({
  totalMs, daily,
}) => {
  const t = useT();

  // 直近 7 日 (= 今日を右端に)。 デザイン検証時はモックの山を立てる。
  const days = useMemo(() => {
    const out: { key: string; label: string; ms: number }[] = [];
    const tag = getLocale() === 'en' ? 'en-US' : 'ja-JP';
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * DAY_MS);
      const k = dayKey(d.getTime());
      const mockMs = MOCK_STATS ? [22, 48, 0, 65, 31, 74, 12][6 - i] * 60_000 : 0;
      out.push({
        key: k,
        label: d.toLocaleDateString(tag, { weekday: 'narrow' }),
        ms: (daily[k] ?? 0) + mockMs,
      });
    }
    return out;
  }, [daily]);

  const maxMs = Math.max(...days.map((d) => d.ms), 1);
  const hasAny = totalMs > 0;

  return (
    <View style={styles.record}>
      <Text style={styles.recordLabel}>{t('portfolio.totalTime')}</Text>
      <Text style={styles.recordTotal}>{formatTotal(totalMs)}</Text>

      {/* 直近 7 日のバー */}
      <Text style={styles.chartLabel}>{t('portfolio.last7days')}</Text>
      <View style={styles.chart}>
        {days.map((d) => (
          <View key={d.key} style={styles.chartCol}>
            <View style={styles.chartTrack}>
              <View
                style={[
                  styles.chartBar,
                  { height: `${Math.max(d.ms > 0 ? 8 : 0, Math.round((d.ms / maxMs) * 100))}%` },
                ]}
              />
            </View>
            <Text style={styles.chartDay}>{d.label}</Text>
          </View>
        ))}
      </View>

      {!hasAny ? <Text style={styles.recordInvite}>{t('portfolio.recordInvite')}</Text> : null}
    </View>
  );
};

const ASIDE_WIDTH = 236;

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
  date: {
    ...typography.labelSmall,
    color: colors.textMute,
    marginBottom: spacing.md,
  },
  greeting: {
    fontFamily: fonts.serifLight,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.5,
    color: colors.ink,
  },

  asideFoot: { gap: spacing.sm },
  mission: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 19,
    color: colors.textBody,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  counterNumber: {
    fontFamily: fonts.serifLight,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1,
    color: colors.ink,
  },
  counterLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
  },

  list: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  column: { gap: spacing.lg },
  itemWrap: { flex: 1, marginBottom: spacing.lg },

  // ── 記録パネル ──
  record: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    maxWidth: 560,
  },
  recordLabel: {
    ...typography.labelSmall,
    color: colors.textMute,
    marginBottom: spacing.sm,
  },
  recordTotal: {
    fontFamily: fonts.serifLight,
    fontSize: 64,
    lineHeight: 72,
    letterSpacing: -1.5,
    color: colors.ink,
  },
  chartLabel: {
    ...typography.labelSmall,
    color: colors.textFaint,
    marginTop: spacing.xxl,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.md,
    height: 110,
  },
  chartCol: { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  chartTrack: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chartBar: {
    width: '100%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: colors.emerald,
    opacity: 0.85,
  },
  chartDay: { ...typography.labelSmall, color: colors.textFaint },

  recordInvite: {
    ...typography.body,
    color: colors.textBody,
    marginTop: spacing.xl,
  },
});
