// Portfolio ヒーローカード (= 画面上部 ~2/5)。
//
// 時計モード ⇄ $モードをトグル:
//   時計: 総撮影時間 + 日別撮影時間の棒グラフ
//   $:    総収益 + 販売クリップ総時間 + 販売ライセンス数 + 累積収益の折れ線
//
// グラフは react-native-svg で自前描画 (= 依存追加なし、 既存 Sparkline と同方針)。

import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import { useT } from '../../i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '../../theme';
import type { DailyBar, PortfolioMetrics, RevenuePoint } from './usePortfolioData';

type Mode = 'time' | 'money';

// 撮影時間 (ms) → { h, m } の表示パーツ。
function hm(ms: number): { h: number; m: number } {
  const min = Math.round(ms / 60000);
  return { h: Math.floor(min / 60), m: min % 60 };
}

export const PortfolioHero: React.FC<{ metrics: PortfolioMetrics; loading: boolean }> = ({
  metrics, loading,
}) => {
  const t = useT();
  const [mode, setMode] = useState<Mode>('time');

  return (
    <View style={styles.card}>
      {/* モードトグル (= 時計 / $) */}
      <View style={styles.toggleRow}>
        <View style={styles.toggle}>
          <ToggleBtn
            active={mode === 'time'}
            onPress={() => setMode('time')}
            a11y={t('portfolio.modeTimeA11y')}
            icon={<ClockIcon active={mode === 'time'} />}
          />
          <ToggleBtn
            active={mode === 'money'}
            onPress={() => setMode('money')}
            a11y={t('portfolio.modeMoneyA11y')}
            icon={
              <Text style={[styles.dollarIcon, { color: mode === 'money' ? colors.card : colors.textMute }]}>$</Text>
            }
          />
        </View>
      </View>

      {mode === 'time' ? (
        <TimeMode metrics={metrics} loading={loading} />
      ) : (
        <MoneyMode metrics={metrics} loading={loading} />
      )}
    </View>
  );
};

// ─── 時計モード ──────────────────────────────────────────────────────
const TimeMode: React.FC<{ metrics: PortfolioMetrics; loading: boolean }> = ({ metrics, loading }) => {
  const t = useT();
  const { h, m } = hm(metrics.totalDurationMs);
  return (
    <>
      <Text style={styles.eyebrow}>{t('portfolio.totalCaptureTime')}</Text>
      <View style={styles.bigRow}>
        <Text style={styles.bigNumber}>{loading ? '—' : h}</Text>
        <Text style={styles.bigUnit}>h</Text>
        <Text style={[styles.bigNumber, styles.bigNumberMin]}>{loading ? '' : String(m).padStart(2, '0')}</Text>
        <Text style={styles.bigUnit}>m</Text>
      </View>

      <Text style={styles.chartLabel}>{t('portfolio.dailyCapture')}</Text>
      <BarChart bars={metrics.dailyBars} />
    </>
  );
};

// ─── $モード ─────────────────────────────────────────────────────────
const MoneyMode: React.FC<{ metrics: PortfolioMetrics; loading: boolean }> = ({ metrics, loading }) => {
  const t = useT();
  const soldH = hm(metrics.soldClipsDurationMs);
  return (
    <>
      <Text style={styles.eyebrow}>{t('portfolio.totalRevenue')}</Text>
      <View style={styles.bigRow}>
        <Text style={styles.bigCurrency}>$</Text>
        <Text style={styles.bigNumber}>{loading ? '—' : metrics.totalRevenueUsdc.toFixed(2)}</Text>
      </View>

      <View style={styles.subStatsRow}>
        <SubStat label={t('portfolio.sold')} value={loading ? '—' : String(metrics.soldCount)} accent />
        <SubStat
          label={t('portfolio.soldHours')}
          value={loading ? '—' : `${soldH.h}h ${String(soldH.m).padStart(2, '0')}m`}
        />
      </View>

      {metrics.revenueSeries.length >= 2 ? (
        <>
          <Text style={styles.chartLabel}>{t('portfolio.cumulativeRevenue')}</Text>
          <LineChart series={metrics.revenueSeries} emptyLabel={t('portfolio.noEarningsYet')} />
        </>
      ) : (
        <Text style={styles.incomeHint}>{t('portfolio.incomeEmptyHint')}</Text>
      )}
    </>
  );
};

// ─── 部品 ────────────────────────────────────────────────────────────
const ToggleBtn: React.FC<{ active: boolean; onPress: () => void; a11y: string; icon: React.ReactNode }> = ({
  active, onPress, a11y, icon,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={a11y}
    style={[styles.toggleBtn, active && styles.toggleBtnActive]}
  >
    {icon}
  </Pressable>
);

const ClockIcon: React.FC<{ active: boolean }> = ({ active }) => {
  const c = active ? colors.card : colors.textMute;
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={6.4} stroke={c} strokeWidth={1.5} />
      <Line x1={8} y1={8} x2={8} y2={4.4} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={8} y1={8} x2={10.6} y2={8} stroke={c} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
};

const SubStat: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <View style={styles.subStat}>
    <Text style={[styles.subValue, accent && { color: colors.emeraldDeep }]}>{value}</Text>
    <Text style={styles.subLabel}>{label}</Text>
  </View>
);

// ─── 棒グラフ (= 日別撮影時間) ────────────────────────────────────────
const BAR_H = 88;
const BarChart: React.FC<{ bars: DailyBar[] }> = ({ bars }) => {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const max = Math.max(0.0001, ...bars.map((b) => b.hours));
  const n = bars.length;
  const gap = 4;
  const barW = n > 0 && w > 0 ? Math.max(2, (w - gap * (n - 1)) / n) : 0;

  const rx = Math.min(3, barW / 2);
  return (
    <View style={styles.chartWrap} onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={BAR_H}>
          {/* baseline */}
          <Line x1={0} y1={BAR_H - 0.5} x2={w} y2={BAR_H - 0.5} stroke={colors.border} strokeWidth={1} />
          {/* 各日のゴーストトラック (= 空の日も枠を出してチャートらしく見せる) */}
          {bars.map((b, i) => (
            <Rect
              key={`t${i}`}
              x={i * (barW + gap)}
              y={4}
              width={barW}
              height={BAR_H - 4}
              rx={rx}
              fill={colors.paperDeep}
            />
          ))}
          {/* 実値バー */}
          {bars.map((b, i) =>
            b.hours > 0 ? (
              <Rect
                key={`b${i}`}
                x={i * (barW + gap)}
                y={BAR_H - Math.max(4, (b.hours / max) * (BAR_H - 6))}
                width={barW}
                height={Math.max(4, (b.hours / max) * (BAR_H - 6))}
                rx={rx}
                fill={b.isToday ? colors.emerald : colors.inkMute}
              />
            ) : null,
          )}
        </Svg>
      ) : null}
    </View>
  );
};

// ─── 折れ線 (= 累積収益) ──────────────────────────────────────────────
const LINE_H = 88;
const LineChart: React.FC<{ series: RevenuePoint[]; emptyLabel: string }> = ({ series, emptyLabel }) => {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  if (series.length < 2) {
    return (
      <View style={[styles.chartWrap, styles.chartEmpty]} onLayout={onLayout}>
        <Text style={styles.chartEmptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  const max = Math.max(...series.map((p) => p.cumUsdc));
  const min = 0;
  const span = max - min || 1;
  const stepX = w / (series.length - 1);
  const pts = series
    .map((p, i) => `${(i * stepX).toFixed(1)},${(LINE_H - ((p.cumUsdc - min) / span) * (LINE_H - 6) - 3).toFixed(1)}`)
    .join(' ');
  const lastX = (series.length - 1) * stepX;
  const lastY = LINE_H - ((series[series.length - 1].cumUsdc - min) / span) * (LINE_H - 6) - 3;

  return (
    <View style={styles.chartWrap} onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={LINE_H}>
          <Polyline points={pts} fill="none" stroke={colors.emerald} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={lastX} cy={lastY} r={4} fill={colors.emerald} />
          <Circle cx={lastX} cy={lastY} r={1.6} fill={colors.card} />
        </Svg>
      ) : null}
    </View>
  );
};

// ─── styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },
  toggleRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.xs },
  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.paperDeep,
    borderRadius: radii.full,
    padding: 3,
    gap: 2,
  },
  toggleBtn: {
    width: 34, height: 28,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.full,
  },
  toggleBtnActive: { backgroundColor: colors.ink },
  dollarIcon: { fontFamily: fonts.serifMedium, fontSize: 16, lineHeight: 18 },

  eyebrow: { ...typography.label, color: colors.textMute },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 2 },
  bigCurrency: { fontFamily: fonts.serifLight, fontSize: 30, color: colors.ink, lineHeight: 52 },
  bigNumber: { fontFamily: fonts.serifLight, fontSize: 52, color: colors.ink, letterSpacing: -1.5, lineHeight: 56 },
  bigNumberMin: { marginLeft: 6 },
  bigUnit: { fontFamily: fonts.sansSemibold, fontSize: 12, letterSpacing: 1, color: colors.textMute, marginBottom: 6 },

  subStatsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm,
  },
  // 左寄せのまま全幅を 2 分割 (= 左に固まらず、 中央寄せにも戻さない)
  subStat: { flex: 1, alignItems: 'flex-start', gap: 1 },
  subValue: { fontFamily: fonts.serifMedium, fontSize: 20, color: colors.ink, letterSpacing: -0.3 },
  subLabel: { ...typography.labelSmall, color: colors.textMute },

  chartLabel: { ...typography.labelSmall, color: colors.textMute, marginTop: spacing.md, marginBottom: 6 },
  chartWrap: { height: BAR_H, width: '100%' },
  chartEmpty: { alignItems: 'center', justifyContent: 'center' },
  chartEmptyText: { ...typography.caption, color: colors.textFaint },

  // 収入ゼロ時の一言 (= 箱・アイコンで逃げず、 素の一行で前向きに)
  incomeHint: { ...typography.caption, color: colors.textMute, marginTop: spacing.md, lineHeight: 19 },
});
