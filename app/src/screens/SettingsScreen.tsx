// Settings タブ (= 横持ち、 2 カラム誌面レイアウト)。
//
// セクション分類 (= ユーザーの関心単位で 4 + 開発者 1):
//   左: • アカウント — アカウント ID / サインアウト
//       • 撮影       — キャリブレーションやり直し
//       • サポート   — 利用規約 / プライバシーポリシー / お問い合わせ
//   右: • アプリ     — 表示言語 / ストレージ使用量 / キャッシュクリア / バージョン
//       • 開発者向け — SERVER / ACCOUNT / AUTH PROVIDER / GitHub (= debug provider 時のみ)
//
// 行は Section が hairline で区切る (= 各行が罫線を持たない。 二重線を作らない)。

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { config } from '../config';
import { useAuth } from '../services/auth';
import { useT, useLocale, setLocale, type Locale } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';
import { LegalDocModal } from '../components/LegalDocModal';
import type { LegalDocKey } from '../content/legalDocs.generated';

export const SettingsScreen: React.FC = () => {
  const { provider, state } = useAuth();
  const t = useT();
  const locale = useLocale();
  const ownerStr = state.status === 'authenticated' ? state.session.pubkey : null;
  const [signingOut, setSigningOut] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);

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
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBlock}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <Text style={styles.subtitle}>{t('settings.subtitle')}</Text>
        </View>

        <View style={styles.grid}>
          {/* ── 左カラム ── */}
          <View style={styles.gridCol}>
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

            <Section title={t('settings.section.capture')}>
              <ActionRow
                label={t('settings.recalibrate')}
                onPress={async () => {
                  try {
                    await AsyncStorage.removeItem('@rootlens/calibration/baseline/v1');
                  } catch {}
                }}
              />
            </Section>

            <Section title={t('settings.section.support')}>
              <ActionRow label={t('settings.terms')} onPress={() => setLegalDoc('tester-consent')} />
              <ActionRow label={t('settings.privacy')} onPress={() => setLegalDoc('privacy-policy')} />
              <ActionRow
                label={t('settings.contact')}
                onPress={() => Linking.openURL('mailto:support@rootlens.io').catch(() => {})}
              />
            </Section>
          </View>

          {/* ── 右カラム ── */}
          <View style={styles.gridCol}>
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
          </View>
        </View>

        <Text style={styles.footnote}>RootLens v{version}</Text>
      </ScrollView>

      <LegalDocModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </SafeAreaView>
  );
};

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
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
    maxWidth: 980,
    alignSelf: 'center',
    width: '100%',
  },

  heroBlock: { gap: 2 },
  title: {
    fontFamily: fonts.serifLight,
    fontSize: 38,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  subtitle: { ...typography.caption, color: colors.textMute },

  grid: {
    flexDirection: 'row',
    gap: spacing.xl,
    alignItems: 'flex-start',
  },
  gridCol: { flex: 1, gap: spacing.xl },

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
  actionRowLabel: { ...typography.captionMedium },

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
    textAlign: 'center',
    fontFamily: fonts.mono,
    fontSize: 11,
  },
});
