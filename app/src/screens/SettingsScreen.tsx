// Settings タブ (UI_SPECS_JA §7)。
//
// セクション構成:
//   • アカウント   — wallet pubkey、 KYC 状態、 サインアウト
//   • 通知         — push 通知 on/off (= placeholder、 expo-notifications 統合は後で)
//   • 撮影         — BGM トラック / ハンドトラッキング overlay (= placeholder)
//   • データ       — ストレージ使用量、 キャッシュクリア
//   • サポート     — お問い合わせ、 利用規約、 プライバシーポリシー
//   • アプリ情報   — バージョン、 リポジトリ
//   • DEVELOPER    — ネットワーク / サーバ endpoint 等 (= debug provider 時のみ)

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

import { config } from '../config';
import { COSIGN_AUTHORITY, SOLANA_RPC_URL } from '../env';
import { useAuth } from '../services/auth';
import { colors, fonts, radii, spacing, typography } from '../theme';

export const SettingsScreen: React.FC = () => {
  const { provider, state } = useAuth();
  const ownerStr = state.status === 'authenticated' ? state.session.pubkey.toBase58() : null;
  const [signingOut, setSigningOut] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [showHandOverlay, setShowHandOverlay] = useState(true);
  const [cacheSize, setCacheSize] = useState<number | null>(null);

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
      'キャッシュをクリア',
      '撮影中の一時ファイルを削除します。 アップロード待ちのクリップは消えません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
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
      'サインアウト',
      provider.id === 'debug'
        ? 'デバッグウォレットを削除して再生成します。 撮影済みクリップは新しい wallet からは見えなくなります。'
        : 'サインアウトします。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'サインアウト',
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
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>RootLens · Physical AI training-data marketplace</Text>
        </View>

        {/* ── アカウント ── */}
        <Section title="アカウント">
          <Row
            label="WALLET"
            value={ownerStr ? shortBase58(ownerStr) : '未認証'}
            mono
            onPress={
              ownerStr
                ? () => Linking.openURL(`https://solscan.io/account/${ownerStr}?cluster=devnet`)
                : undefined
            }
          />
          <Row label="AUTH PROVIDER" value={provider.id} />
          <Row label="KYC STATUS" value="未対応 (= 次の更新で実装)" tone="mute" />
        </Section>

        {/* ── 通知 ── */}
        <Section title="通知">
          <SwitchRow
            label="プッシュ通知"
            sublabel="クリップ処理完了 / ライセンス販売の通知"
            value={pushEnabled}
            onValueChange={setPushEnabled}
            disabled={true}
            disabledNote="未実装 (= expo-notifications 統合予定)"
          />
        </Section>

        {/* ── 撮影 ── */}
        <Section title="撮影">
          <SwitchRow
            label="ハンドトラッキング表示"
            sublabel="プレビュー上に手のスケルトンを描画"
            value={showHandOverlay}
            onValueChange={setShowHandOverlay}
            disabled={true}
            disabledNote="次の更新で有効化"
          />
          <Row label="BGM トラック" value="ambient-01 (default)" tone="mute" />
        </Section>

        {/* ── データ ── */}
        <Section title="データ">
          <Row
            label="ストレージ使用量"
            value={cacheSize === null ? '計算中…' : formatBytes(cacheSize)}
          />
          <ActionRow label="キャッシュをクリア" onPress={onClearCache} kind="warn" />
        </Section>

        {/* ── サポート ── */}
        <Section title="サポート">
          <ActionRow
            label="利用規約"
            onPress={() => Linking.openURL(`${config.serverUrl}/legal/terms`).catch(() => {})}
          />
          <ActionRow
            label="プライバシーポリシー"
            onPress={() => Linking.openURL(`${config.serverUrl}/legal/privacy`).catch(() => {})}
          />
          <ActionRow
            label="お問い合わせ"
            onPress={() => Linking.openURL('mailto:support@rootlens.io').catch(() => {})}
          />
        </Section>

        {/* ── アプリ情報 ── */}
        <Section title="アプリ情報">
          <Row label="VERSION" value={version} />
          <Row label="BUILD" value="devnet · debug" tone="mute" />
          <ActionRow
            label="GitHub リポジトリ"
            onPress={() => Linking.openURL('https://github.com/yudai-mori-2004/root-lens').catch(() => {})}
          />
        </Section>

        {/* ── DEVELOPER (= debug provider 時のみ表示) ── */}
        {provider.id === 'debug' ? (
          <Section title="Developer" tone="muted">
            <Row label="CLUSTER" value="devnet" tone="ok" />
            <Row label="SOLANA RPC" value={SOLANA_RPC_URL} mono />
            <Row label="COSIGN AUTHORITY" value={shortBase58(COSIGN_AUTHORITY)} mono />
            <Row label="SERVER" value={config.serverUrl} mono onPress={() => Linking.openURL(config.serverUrl)} />
            <Row label="VLM GATE" value={config.vlmGateUrl} mono />
            <Row label="TP PROXY" value={`${config.serverUrl}/api/v1/tp-proxy/*`} mono />
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
          <Text style={styles.signOutLabel}>{signingOut ? 'SIGNING OUT…' : 'SIGN OUT'}</Text>
        </Pressable>

        <Text style={styles.footnote}>v{version} · {provider.id}</Text>
      </ScrollView>
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
