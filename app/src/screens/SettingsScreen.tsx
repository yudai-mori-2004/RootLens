import React, { useMemo } from 'react';
import { Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { config } from '../config';
import { getDemoSigner, getDemoWalletPubkey } from '../domain/wallet';
import { colors, fonts, radii, spacing, typography } from '../theme';

// SETTINGS タブ — wallet, network, app version など読み取り専用情報。
// 操作系 (logout, switch wallet, sign out) は今は未実装。
//
// セクション:
//   • Wallet      pubkey + signer 有無 + Solscan link
//   • Network     Solana RPC, DAS, TP gateway proxy URL
//   • Servers     web (rootlens.io) endpoints
//   • About       app version, build channel

const ENV = process.env as Record<string, string | undefined>;

export const SettingsScreen: React.FC = () => {
  const ownerPubkey = useMemo(() => getDemoWalletPubkey(), []);
  const signer = useMemo(() => getDemoSigner(), []);
  const ownerStr = ownerPubkey?.toBase58() ?? null;

  const rpc = ENV.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const das = ENV.EXPO_PUBLIC_DAS_URL || rpc;
  const cosignAuthority = ENV.EXPO_PUBLIC_COSIGN_AUTHORITY || '—';
  const version = (Constants.expoConfig?.version as string | undefined) ?? '0.1.0';

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Read-only — login & switching deferred to next phase.</Text>

        <Section title="Wallet">
          <Row
            label="OWNER"
            value={ownerStr ?? 'not set'}
            onPress={
              ownerStr
                ? () => Linking.openURL(`https://solscan.io/account/${ownerStr}?cluster=devnet`)
                : undefined
            }
          />
          <Row
            label="SIGNER"
            value={signer ? 'available (env keypair)' : 'missing — stake disabled'}
            tone={signer ? 'ok' : 'warn'}
          />
          <Row label="COSIGN AUTHORITY" value={cosignAuthority} />
        </Section>

        <Section title="Network">
          <Row label="CLUSTER" value="devnet" tone="ok" />
          <Row label="RPC" value={rpc} />
          <Row label="DAS" value={das} />
        </Section>

        <Section title="Servers">
          <Row label="WEB" value={config.serverUrl} onPress={() => Linking.openURL(config.serverUrl)} />
          <Row label="UPLOAD URL" value={config.uploadUrlEndpoint} />
          <Row label="VLM GATE" value={config.vlmGateUrl} />
          <Row label="TP PROXY" value={`${config.serverUrl}/api/v1/tp-proxy/*`} />
        </Section>

        <Section title="About">
          <Row label="APP VERSION" value={version} />
          <Row
            label="REPO"
            value="github.com/yudai-mori-2004/root-lens"
            onPress={() => Linking.openURL('https://github.com/yudai-mori-2004/root-lens')}
          />
        </Section>

        <View style={styles.footnote}>
          <Text style={styles.footnoteText}>
            RootLens · Physical AI training-data marketplace · v0.1.2 sandbox
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// ---- helpers -----------------------------------------------------------

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

const Row: React.FC<{
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'mute';
  onPress?: () => void;
}> = ({ label, value, tone, onPress }) => {
  const valueColor =
    tone === 'ok'
      ? colors.emeraldDeep
      : tone === 'warn'
      ? colors.warn
      : colors.ink;
  const inner = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, { color: valueColor }, onPress && styles.rowValueLink]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && styles.rowPressed]}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
};

// ---- Styles ------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },

  title: {
    fontFamily: fonts.serifSemibold,
    fontSize: 32,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  subtitle: { ...typography.body, color: colors.textBody },

  section: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMute,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionBody: {},

  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  rowPressed: { backgroundColor: colors.paperDeep },
  rowLabel: { ...typography.labelSmall, color: colors.textMute },
  rowValue: {
    ...typography.mono,
    color: colors.ink,
    fontSize: 12,
  },
  rowValueLink: { textDecorationLine: 'underline' },

  footnote: {
    paddingTop: spacing.xl,
    alignItems: 'center',
  },
  footnoteText: {
    ...typography.caption,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
