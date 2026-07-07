// Settings タブ (= 横持ち、 扉カラム + 設定リスト)。
//
// セクションは「よく触る順」 に上から並べる (2026-07-06 判断):
//   • アカウント — アカウント ID / サインアウト
//   • アプリ     — 表示言語 / ストレージ使用量 / キャッシュクリア / バージョン
//   • サポート   — 利用規約 / プライバシーポリシー / お問い合わせ
//   • 撮影       — 解像度 / レート / ストリーム (= ほぼ触らないので下)
//   • 開発者向け — SERVER / ACCOUNT / AUTH PROVIDER / GitHub / 効果音テスト (= debug provider 時のみ)
//
// 行は Section が hairline で区切る (= 各行が罫線を持たない。 二重線を作らない)。

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Switch,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';

import { config } from '../config';
import { useAuth } from '../services/auth';
import { useT, useLocale, setLocale, type Locale } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';
import { LegalDocModal } from '../components/LegalDocModal';
import { playSfxAwait, type SfxName } from '../services/captureSounds';
import {
  DEFAULT_CAPTURE_SETTINGS,
  loadCaptureSettings,
  saveCaptureSettings,
  type CaptureSettings,
  type CaptureResolution,
  type ImuRate,
  type RecordingRate,
} from '../services/captureSettings';
import type { LegalDocKey } from '../content/legalDocs.generated';

export const SettingsScreen: React.FC = () => {
  const { provider, state } = useAuth();
  const t = useT();
  const insets = useSafeAreaInsets();
  const locale = useLocale();
  const ownerStr = state.status === 'authenticated' ? state.session.pubkey : null;
  const [signingOut, setSigningOut] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);

  // 撮影設定 (= Stera 同構成)。 保存は即時、 適用は次の撮影画面オープンから。
  const [cs, setCs] = useState<CaptureSettings>({ ...DEFAULT_CAPTURE_SETTINGS });
  useEffect(() => {
    loadCaptureSettings().then(setCs).catch(() => {});
  }, []);
  const updateCs = (patch: Partial<CaptureSettings>) => {
    setCs((cur) => {
      const next = { ...cur, ...patch };
      saveCaptureSettings(next).catch(() => {});
      return next;
    });
  };

  const version = (Constants.expoConfig?.version as string | undefined) ?? '0.1.0';

  // キャッシュサイズを起動時に計算
  useEffect(() => {
    void refreshCacheSize();
  }, []);

  const refreshCacheSize = async () => {
    try {
      const dir = FileSystem.cacheDirectory;
      if (!dir) return;
      const items = await FileSystem.readDirectoryAsync(dir);
      let total = 0;
      for (const name of items) {
        try {
          const info = await FileSystem.getInfoAsync(`${dir}${name}`, { size: true });
          if (info.exists && 'size' in info) total += (info as { size: number }).size;
        } catch {}
      }
      setCacheSize(total);
    } catch {
      setCacheSize(null);
    }
  };

  const onClearCache = () => {
    Alert.alert(
      t('settings.clearCacheTitle'),
      t('settings.clearCacheMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const dir = FileSystem.cacheDirectory;
              if (!dir) return;
              const items = await FileSystem.readDirectoryAsync(dir);
              for (const name of items) {
                await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
              }
            } catch {}
            void refreshCacheSize();
          },
        },
      ],
    );
  };

  const onLogout = () => {
    Alert.alert(
      t('settings.signOut'),
      provider.id === 'debug'
        ? t('settings.signOutDebugMessage')
        : t('settings.signOutMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.signOut'),
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await provider.logout();
            } finally {
              setSigningOut(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.root, { paddingLeft: insets.left }]}>
      {/* ── 左: 扉カラム (= マイビデオと対称) ── */}
      <View style={styles.aside}>
        <View style={styles.asideHead}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <Text style={styles.subtitle}>{t('settings.subtitle')}</Text>
        </View>
        <Text style={styles.footnote}>RootLens v{version}</Text>
      </View>

      {/* ── 右: 設定リスト (= 一列) ── */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Section title={t('settings.section.account')}>
          <Row
            label={t('settings.accountId')}
            value={ownerStr ? shortBase58(ownerStr) : t('settings.unauthenticated')}
            mono
          />
          <ActionRow
            label={signingOut ? t('settings.signingOut') : t('settings.signOut')}
            onPress={onLogout}
            kind="danger"
            disabled={signingOut || state.status !== 'authenticated'}
          />
        </Section>

        <Section title={t('settings.section.app')}>
          <SegmentRow
            label={t('settings.languageLabel')}
            value={locale}
            options={[
              { value: 'ja', label: t('settings.languageJa') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
            onChange={(v) => setLocale(v as Locale)}
          />
          <Row
            label={t('settings.storageUsage')}
            value={cacheSize === null ? t('settings.calculating') : formatBytes(cacheSize)}
          />
          <ActionRow label={t('settings.clearCache')} onPress={onClearCache} kind="warn" />
          <Row label={t('settings.version')} value={version} />
        </Section>

        <Section title={t('settings.section.support')}>
          <ActionRow label={t('settings.terms')} onPress={() => setLegalDoc('terms-of-service')} />
          <ActionRow label={t('settings.privacy')} onPress={() => setLegalDoc('privacy-policy')} />
          <ActionRow
            label={t('settings.contact')}
            onPress={() => Linking.openURL('mailto:support@rootlens.io').catch(() => {})}
          />
        </Section>

        <Section title={t('settings.section.capture')}>
          <SegmentRow
            label={t('settings.capture.resolution')}
            value={cs.resolution}
            options={[
              { value: '1440p', label: t('settings.capture.res1440') },
              { value: '1080p', label: '1080p' },
              { value: '720p', label: '720p' },
            ]}
            onChange={(v) => updateCs({ resolution: v as CaptureResolution })}
          />
          <SwitchRow
            label={t('settings.capture.autoFocus')}
            value={cs.autoFocus}
            onChange={(v) => updateCs({ autoFocus: v })}
          />
          <SegmentRow
            label={t('settings.capture.recordingRate')}
            value={String(cs.recordingRate)}
            options={[
              { value: '15', label: '15 Hz' },
              { value: '30', label: '30 Hz' },
              { value: '60', label: '60 Hz' },
            ]}
            onChange={(v) => updateCs({ recordingRate: Number(v) as RecordingRate })}
          />
          <SwitchRow
            label={t('settings.capture.syncRate')}
            value={cs.syncRate}
            onChange={(v) => updateCs({ syncRate: v })}
          />
          {!cs.syncRate ? (
            <SegmentRow
              label={t('settings.capture.depthRate')}
              value={String(cs.depthRate)}
              options={[
                { value: '15', label: '15 Hz' },
                { value: '30', label: '30 Hz' },
                { value: '60', label: '60 Hz' },
              ]}
              onChange={(v) => updateCs({ depthRate: Number(v) as RecordingRate })}
            />
          ) : null}
          {!cs.syncRate ? (
            <SegmentRow
              label={t('settings.capture.pointCloudRate')}
              value={String(cs.pointCloudRate)}
              options={[
                { value: '15', label: '15 Hz' },
                { value: '30', label: '30 Hz' },
                { value: '60', label: '60 Hz' },
              ]}
              onChange={(v) => updateCs({ pointCloudRate: Number(v) as RecordingRate })}
            />
          ) : null}
          <SegmentRow
            label={t('settings.capture.imuRate')}
            value={String(cs.imuRateHz)}
            options={[
              { value: '50', label: '50 Hz' },
              { value: '100', label: '100 Hz' },
              { value: '200', label: '200 Hz' },
            ]}
            onChange={(v) => updateCs({ imuRateHz: Number(v) as ImuRate })}
          />
          <SwitchRow
            label={t('settings.capture.streamImu')}
            value={cs.streamImu}
            onChange={(v) => updateCs({ streamImu: v })}
          />
          <SwitchRow
            label={t('settings.capture.streamDepth')}
            value={cs.streamDepth}
            onChange={(v) => updateCs({ streamDepth: v })}
          />
          <SwitchRow
            label={t('settings.capture.streamPointCloud')}
            value={cs.streamPointCloud}
            onChange={(v) => updateCs({ streamPointCloud: v })}
          />
          <SwitchRow
            label={t('settings.capture.streamMesh')}
            value={cs.streamMesh}
            onChange={(v) => updateCs({ streamMesh: v })}
          />
          {/* 自動サイクル撮影 (= N 分録画 → 休止 → 再開のループ)。 有効時のみ分数を出す。 */}
          <SwitchRow
            label={t('settings.capture.cycleEnabled')}
            value={cs.cycleEnabled}
            onChange={(v) => updateCs({ cycleEnabled: v })}
          />
          {cs.cycleEnabled ? (
            <StepperRow
              label={t('settings.capture.cycleRecord')}
              value={cs.cycleRecordMinutes}
              min={1}
              max={90}
              unit={t('settings.capture.minutesUnit')}
              onChange={(v) => updateCs({ cycleRecordMinutes: v })}
            />
          ) : null}
          {cs.cycleEnabled ? (
            <StepperRow
              label={t('settings.capture.cyclePause')}
              value={cs.cyclePauseMinutes}
              min={1}
              max={30}
              unit={t('settings.capture.minutesUnit')}
              onChange={(v) => updateCs({ cyclePauseMinutes: v })}
            />
          ) : null}
        </Section>

        {/* ── 開発者向け (= debug provider 時のみ表示) ── */}
        {provider.id === 'debug' ? (
          <Section title={t('settings.section.developer')} tone="muted">
            <Row label="SERVER" value={config.serverUrl} mono onPress={() => Linking.openURL(config.serverUrl)} />
            <Row label="ACCOUNT" value={ownerStr ?? '—'} mono />
            <Row label="AUTH PROVIDER" value={provider.id} mono />
            <ActionRow
              label="GitHub"
              onPress={() => Linking.openURL('https://github.com/yudai-mori-2004/root-lens').catch(() => {})}
            />
          </Section>
        ) : null}

        {/* ── 効果音の試聴 (= tools/asset-gen/gen-sfx.py で再生成 → reload で反映) ── */}
        {provider.id === 'debug' ? (
          <Section title="効果音テスト" tone="muted">
            {SFX_NAMES.map((name) => (
              <ActionRow key={name} label={name} onPress={() => { void playSfxAwait(name); }} />
            ))}
          </Section>
        ) : null}
      </ScrollView>

      <LegalDocModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </View>
  );
};

const SFX_NAMES: SfxName[] = [
  'enter_capture', 'detect_palm', 'detect_thumbs_up',
  'countdown_tick', 'countdown_end', 'rec_stop', 'warn_hand_lost',
];

// ─── building blocks ────────────────────────────────────────────────────
// Section が行間の hairline を一元管理する (= 行コンポーネントは罫線を持たない)。

const Section: React.FC<{ title: string; tone?: 'normal' | 'muted'; children: React.ReactNode }> = ({
  title, tone, children,
}) => {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View>
      <Text style={[styles.sectionTitle, tone === 'muted' && { color: colors.textFaint }]}>{title}</Text>
      <View style={styles.sectionCard}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
};

const Row: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  onPress?: () => void;
}> = ({ label, value, mono, onPress }) => {
  const inner = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, mono && styles.rowValueMono, onPress && styles.rowValueLink]}
        numberOfLines={1}
        ellipsizeMode="middle"
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

const Chevron: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <Path d="M5 3.5 L9 7 L5 10.5" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ActionRow: React.FC<{
  label: string;
  onPress: () => void;
  kind?: 'warn' | 'danger' | 'normal';
  disabled?: boolean;
}> = ({ label, onPress, kind, disabled }) => {
  const color =
    kind === 'warn' ? colors.warn :
    kind === 'danger' ? colors.danger :
    colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
    >
      <Text style={[styles.actionRowLabel, { color }]}>{label}</Text>
      <Chevron color={kind ? color : colors.textFaint} />
    </Pressable>
  );
};

/// 1 行に収まるコンパクトなセグメント切替 (= ラベル左、 セグメント右)。
const SwitchRow: React.FC<{
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, value, onChange }) => (
  <View style={styles.segmentRow}>
    <Text style={styles.rowLabelInline}>{label}</Text>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: colors.emerald, false: colors.border }}
      thumbColor="#FFFFFF"
    />
  </View>
);

/// 分数などの任意整数を −/+ で増減するステッパ (= ラベル左、 [−] 値 [+] 右)。
const StepperRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, unit, onChange }) => {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <View style={styles.segmentRow}>
      <Text style={styles.rowLabelInline}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.segmentBtnPressed, value <= min && styles.rowDisabled]}
          hitSlop={6}
        >
          <Text style={styles.stepBtnLabel}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}{unit}</Text>
        <Pressable
          onPress={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.segmentBtnPressed, value >= max && styles.rowDisabled]}
          hitSlop={6}
        >
          <Text style={styles.stepBtnLabel}>+</Text>
        </Pressable>
      </View>
    </View>
  );
};

const SegmentRow: React.FC<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <View style={styles.segmentRow}>
    <Text style={styles.rowLabelInline}>{label}</Text>
    <View style={styles.segmentControl}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.segmentBtn,
              active && styles.segmentBtnActive,
              pressed && !active && styles.segmentBtnPressed,
            ]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  </View>
);

// ─── helpers ────────────────────────────────────────────────────────────

function shortBase58(s: string | null | undefined): string {
  if (!s) return '—';
  if (s.length <= 16) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─── styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.paper },

  aside: {
    width: 236,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    justifyContent: 'space-between',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  asideHead: { gap: 6 },
  title: {
    fontFamily: fonts.serifLight,
    fontSize: 26,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  subtitle: { ...typography.caption, fontSize: 12, color: colors.textMute },

  list: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.xl,
    maxWidth: 560,
    width: '100%',
  },

  sectionTitle: {
    ...typography.labelSmall,
    color: colors.textMute,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.borderLight, marginLeft: spacing.lg },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  rowPressed: { backgroundColor: colors.paperDeep },
  rowDisabled: { opacity: 0.45 },
  rowLabel: { ...typography.captionMedium, color: colors.textBody },
  rowLabelInline: { ...typography.captionMedium, color: colors.textBody },
  rowValue: {
    ...typography.caption,
    color: colors.textMute,
    flexShrink: 1,
    textAlign: 'right',
  },
  rowValueMono: { fontFamily: fonts.mono, fontSize: 12 },
  rowValueLink: { textDecorationLine: 'underline' },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  actionRowLabel: { ...typography.captionMedium, flexShrink: 1 },

  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  segmentControl: {
    flexDirection: 'row',
    backgroundColor: colors.paperDeep,
    borderRadius: radii.md,
    padding: 2.5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBtn: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.paperDeep,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepBtnLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 18,
    lineHeight: 20,
    color: colors.ink,
  },
  stepValue: {
    minWidth: 44,
    textAlign: 'center',
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.ink,
  },
  segmentBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  segmentBtnActive: {
    backgroundColor: colors.card,
    shadowColor: '#0E1F44',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentBtnPressed: { opacity: 0.6 },
  segmentLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.textMute,
  },
  segmentLabelActive: {
    color: colors.ink,
    fontFamily: fonts.sansSemibold,
  },

  footnote: {
    ...typography.caption,
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
});
