// Settings タブ。
//
// セクション構成:
//   • 言語         — ja / en
//   • アカウント   — アカウント ID (= 端末が持つ鍵の公開鍵)、 サインアウト
//   • 通知         — push 通知 on/off (= placeholder、 expo-notifications 統合は後で)
//   • 撮影         — ハンドトラッキング overlay (= placeholder) / キャリブレーションやり直し
//   • データ       — ストレージ使用量、 キャッシュクリア
//   • サポート     — お問い合わせ、 利用規約、 プライバシーポリシー
//   • アプリ情報   — バージョン、 リポジトリ
//   • DEVELOPER    — サーバ endpoint 等 (= debug provider 時のみ)

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
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
  const [pushEnabled, setPushEnabled] = useState(false);
  const [showHandOverlay, setShowHandOverlay] = useState(true);
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

        {/* ── 言語 ── */}
        <Section title={t('settings.section.language')}>
          <SegmentRow
            label={t('settings.languageLabel')}
            sublabel={t('settings.languageDesc')}
            value={locale}
            options={[
              { value: 'ja', label: t('settings.languageJa') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
            onChange={(v) => setLocale(v as Locale)}
          />
        </Section>

        {/* ── アカウント ── */}
        <Section title={t('settings.section.account')}>
          <Row
            label={t('settings.accountId')}
            value={ownerStr ? shortBase58(ownerStr) : t('settings.unauthenticated')}
            mono
          />
          <Row label={t('settings.authProvider')} value={provider.id} />
        </Section>

        {/* ── 通知 ── */}
        <Section title={t('settings.section.notifications')}>
          <SwitchRow
            label={t('settings.pushNotifications')}
            sublabel={t('settings.pushNotificationsDesc')}
            value={pushEnabled}
            onValueChange={setPushEnabled}
            disabled={true}
            disabledNote={t('settings.pushNotImplemented')}
          />
        </Section>

        {/* ── 撮影 ── */}
        <Section title={t('settings.section.capture')}>
          <SwitchRow
            label={t('settings.handOverlay')}
            sublabel={t('settings.handOverlayDesc')}
            value={showHandOverlay}
            onValueChange={setShowHandOverlay}
            disabled={true}
            disabledNote={t('settings.handOverlaySoon')}
          />
          <ActionRow
            label={t('settings.recalibrate')}
            onPress={async () => {
              try {
                await AsyncStorage.removeItem('@rootlens/calibration/baseline/v1');
              } catch {}
            }}
          />
        </Section>

        {/* ── データ ── */}
        <Section title={t('settings.section.data')}>
          <Row
            label={t('settings.storageUsage')}
            value={cacheSize === null ? t('settings.calculating') : formatBytes(cacheSize)}
          />
          <ActionRow label={t('settings.clearCache')} onPress={onClearCache} kind="warn" />
        </Section>

        {/* ── サポート ── */}
        <Section title={t('settings.section.support')}>
          <ActionRow label={t('settings.terms')} onPress={() => setLegalDoc('tester-consent')} />
          <ActionRow label={t('settings.privacy')} onPress={() => setLegalDoc('privacy-policy')} />
          <ActionRow
            label={t('settings.contact')}
            onPress={() => Linking.openURL('mailto:support@rootlens.io').catch(() => {})}
          />
        </Section>

        {/* ── アプリ情報 ── */}
        <Section title={t('settings.section.appInfo')}>
          <Row label={t('settings.version')} value={version} />
          <ActionRow
            label={t('settings.githubRepo')}
            onPress={() => Linking.openURL('https://github.com/yudai-mori-2004/root-lens').catch(() => {})}
          />
        </Section>

        {/* ── DEVELOPER (= debug provider 時のみ表示) ── */}
        {provider.id === 'debug' ? (
          <Section title={t('settings.section.developer')} tone="muted">
            <Row label="SERVER" value={config.serverUrl} mono onPress={() => Linking.openURL(config.serverUrl)} />
            <Row label="ACCOUNT" value={ownerStr ?? '—'} mono />
          </Section>
        ) : null}

        {/* ── Sign out ── */}
        <Pressable
          onPress={onLogout}
          disabled={signingOut || state.status !== 'authenticated'}
          style={({ pressed }) => [
            styles.signOutBtn,
            pressed && styles.signOutBtnPressed,
            (signingOut || state.status !== 'authenticated') && styles.signOutBtnDisabled,
          ]}
        >
          <Text style={styles.signOutLabel}>{signingOut ? t('settings.signingOut') : t('settings.signOut')}</Text>
        </Pressable>

        <Text style={styles.footnote}>v{version} · {provider.id}</Text>
      </ScrollView>

      <LegalDocModal doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </SafeAreaView>
  );
};

// ─── building blocks ────────────────────────────────────────────────────

const Section: React.FC<{ title: string; tone?: 'normal' | 'muted'; children: React.ReactNode }> = ({
  title, tone, children,
}) => (
  <View style={styles.section}>
    <Text style={[styles.sectionTitle, tone === 'muted' && { color: colors.textFaint }]}>{title}</Text>
    <View style={styles.sectionCard}>{children}</View>
  </View>
);

const Row: React.FC<{
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'mute';
  mono?: boolean;
  onPress?: () => void;
}> = ({ label, value, tone, mono, onPress }) => {
  const valueColor =
    tone === 'ok' ? colors.emeraldDeep :
    tone === 'warn' ? colors.warn :
    tone === 'mute' ? colors.textMute :
    colors.ink;
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
        numberOfLines={2}
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

const SwitchRow: React.FC<{
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  disabledNote?: string;
}> = ({ label, sublabel, value, onValueChange, disabled, disabledNote }) => (
  <View style={[styles.row, styles.switchRow]}>
    <View style={styles.switchRowText}>
      <Text style={styles.switchLabel}>{label}</Text>
      {sublabel ? <Text style={styles.switchSublabel}>{disabled ? (disabledNote ?? sublabel) : sublabel}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.border, true: colors.emerald }}
      thumbColor={colors.card}
    />
  </View>
);

const ActionRow: React.FC<{ label: string; onPress: () => void; kind?: 'warn' | 'normal' }> = ({
  label, onPress, kind,
}) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
    <Text style={[styles.actionRowLabel, kind === 'warn' && { color: colors.warn }]}>{label}</Text>
    <Text style={[styles.actionRowChevron, kind === 'warn' && { color: colors.warn }]}>›</Text>
  </Pressable>
);

/// セグメント切替 (= 言語選択など離散的な 2-4 値)。
/// iOS の UISegmentedControl 相当を Editorial Fintech 色で再現。
const SegmentRow: React.FC<{
  label: string;
  sublabel?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}> = ({ label, sublabel, value, options, onChange }) => (
  <View style={[styles.row, styles.segmentRow]}>
    <View style={styles.segmentRowText}>
      <Text style={styles.switchLabel}>{label}</Text>
      {sublabel ? <Text style={styles.switchSublabel}>{sublabel}</Text> : null}
    </View>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },

  heroBlock: { gap: 4, marginBottom: spacing.md },
  title: {
    fontFamily: fonts.serifLight,
    fontSize: 44,
    letterSpacing: -0.8,
    color: colors.ink,
  },
  subtitle: { ...typography.caption, color: colors.textMute },

  section: {},
  sectionTitle: {
    ...typography.label,
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

  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  rowPressed: { backgroundColor: colors.paperDeep },
  rowLabel: { ...typography.labelSmall, color: colors.textMute },
  rowValue: { ...typography.body, color: colors.ink, fontSize: 14 },
  rowValueLink: { textDecorationLine: 'underline' },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  switchRowText: { flex: 1, gap: 2, paddingRight: spacing.md },
  switchLabel: { fontFamily: fonts.sansSemibold, fontSize: 14, color: colors.ink },
  switchSublabel: { ...typography.caption, color: colors.textMute },

  segmentRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  segmentRowText: { gap: 2, marginBottom: 4 },
  segmentControl: {
    flexDirection: 'row',
    backgroundColor: colors.paperDeep,
    borderRadius: radii.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
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
    fontSize: 13,
    color: colors.textMute,
    letterSpacing: 0.2,
  },
  segmentLabelActive: {
    color: colors.ink,
    fontFamily: fonts.sansSemibold,
  },

  actionRowLabel: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.ink,
  },
  actionRowChevron: {
    position: 'absolute',
    right: spacing.lg,
    top: '50%',
    marginTop: -10,
    fontSize: 20,
    color: colors.textMute,
  },

  signOutBtn: {
    marginTop: spacing.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  signOutBtnPressed: { backgroundColor: colors.paperDeep },
  signOutBtnDisabled: { opacity: 0.4 },
  signOutLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.danger,
  },

  footnote: {
    ...typography.caption,
    color: colors.textFaint,
    textAlign: 'center',
    paddingTop: spacing.lg,
    fontFamily: fonts.mono,
  },
});
