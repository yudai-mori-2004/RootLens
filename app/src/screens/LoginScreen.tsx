import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../app/types';
import { colors, typography, spacing, radii } from '../theme';
import { getDemoWalletPubkey } from '../domain/wallet';

// SPECS_JA §1.2: 供給者は KYC 済みの個人。本来は Privy embedded wallet で login。
// 統合検証フェーズでは EXPO_PUBLIC_DEMO_WALLET_ADDRESS から固定 pubkey を使う。

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const pubkey = getDemoWalletPubkey();
  const pubkeyShort = pubkey
    ? `${pubkey.toBase58().slice(0, 6)}…${pubkey.toBase58().slice(-6)}`
    : null;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>ROOTLENS</Text>
        <Text style={styles.heading}>Physical AI training-data collection</Text>
        <Text style={styles.lede}>
          Record household chores. Mint a Root NFT. Earn revenue when AI labs license your clip.
        </Text>

        {pubkey ? (
          <View style={styles.walletBlock}>
            <Text style={styles.walletLabel}>DEMO WALLET (devnet)</Text>
            <Text style={styles.walletPubkey}>{pubkeyShort}</Text>
            <Text style={styles.walletNote}>
              Privy login bypassed — using fixed wallet from .env
            </Text>
          </View>
        ) : (
          <View style={styles.errorBlock}>
            <Text style={styles.errorLabel}>NO WALLET CONFIGURED</Text>
            <Text style={styles.errorBody}>
              Set EXPO_PUBLIC_DEMO_WALLET_ADDRESS in app/.env to a base58 Solana pubkey, then
              reload.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.cta,
            !pubkey && styles.ctaDisabled,
            pressed && pubkey && styles.ctaPressed,
          ]}
          onPress={() => navigation.replace('TaskList')}
          disabled={!pubkey}
        >
          <Text style={styles.ctaLabel}>Continue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between' },
  body: { padding: spacing.xl, gap: spacing.md },
  eyebrow: {
    ...typography.label,
    color: colors.textSecondary,
    letterSpacing: 1.6,
    marginTop: spacing.xl,
  },
  heading: { ...typography.heading, color: colors.textPrimary },
  lede: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },

  walletBlock: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.accentLight,
    borderRadius: radii.md,
    gap: 4,
  },
  walletLabel: {
    ...typography.label,
    color: colors.accent,
    letterSpacing: 1.4,
  },
  walletPubkey: {
    fontSize: 14,
    fontFamily: 'Menlo',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  walletNote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  errorBlock: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.errorLight,
    borderRadius: radii.md,
    gap: 4,
  },
  errorLabel: { ...typography.label, color: colors.error, letterSpacing: 1.4 },
  errorBody: { ...typography.body, color: colors.textPrimary, marginTop: spacing.xs },

  footer: { padding: spacing.xl },
  cta: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  ctaPressed: { backgroundColor: colors.accentDark },
  ctaDisabled: { backgroundColor: colors.textDisabled },
  ctaLabel: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
