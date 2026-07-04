// Login screen。 認証 provider の login() を起動する。
//
// DebugAuthProvider の場合は SecureStore からアカウント鍵を復元 / 生成するだけなので、
// 「サインイン」 押下で即 authenticated になる。 本格認証を入れる時は provider.login() の中で
// 認証フローを開く想定。

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RootStackParamList } from '../app/types';
import { useAuth } from '../services/auth';
import { useT } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { provider, state } = useAuth();
  const t = useT();
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // すでに authenticated なら Main に飛ぶ (= AuthGate の初期化が間に合った場合)
  useEffect(() => {
    if (state.status === 'authenticated') {
      navigation.replace('Main');
    }
  }, [state.status, navigation]);

  const onContinue = async () => {
    setLoggingIn(true);
    setError(null);
    try {
      await provider.login();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoggingIn(false);
    }
  };

  const providerLabel = provider.id === 'debug' ? t('login.debugAccount') : provider.id;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <View style={styles.markRow}>
          <Mark />
          <Text style={styles.markText}>ROOTLENS</Text>
        </View>

        <View style={styles.heroBlock}>
          <Text style={styles.heroLineA}>{t('login.heroLineA')}</Text>
          <Text style={styles.heroLineB}>
            {t('login.heroBPrefix')}
            <Text style={styles.heroLineBAccent}>{t('login.heroBAccent')}</Text>
            {t('login.heroBSuffix')}
          </Text>
        </View>

        <Text style={styles.lede}>
          {t('login.lede')}
        </Text>

        <View style={styles.providerCard}>
          <Text style={styles.providerEyebrow}>{t('settings.authProvider')}</Text>
          <Text style={styles.providerValue}>{providerLabel}</Text>
          <Text style={styles.providerNote}>
            {t('login.providerNote')}
          </Text>
        </View>

        {error && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorLabel}>{t('login.signInFailed')}</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.cta,
            loggingIn && styles.ctaDisabled,
            pressed && !loggingIn && styles.ctaPressed,
          ]}
          onPress={onContinue}
          disabled={loggingIn}
        >
          {loggingIn ? (
            <ActivityIndicator color={colors.textOnInk} />
          ) : (
            <Text style={styles.ctaLabel}>{t('login.signIn')}</Text>
          )}
        </Pressable>
        <Text style={styles.tos}>
          {t('login.tos')}
        </Text>
      </View>
    </SafeAreaView>
  );
};

const Mark: React.FC = () => (
  <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
    <Circle cx={14} cy={14} r={13} stroke={colors.ink} strokeWidth={1.4} />
    <Circle cx={14} cy={14} r={6.5} stroke={colors.ink} strokeWidth={1.4} />
    <Path d="M14 1v6.5M14 20.5V27M1 14h6.5M20.5 14H27" stroke={colors.ink} strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, justifyContent: 'space-between' },
  body: { padding: spacing.xl, gap: spacing.lg },

  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  markText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 2.4,
    color: colors.ink,
  },

  heroBlock: {
    marginTop: spacing.xxl,
    gap: 2,
  },
  heroLineA: {
    fontFamily: fonts.serifLight,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -0.8,
    color: colors.ink,
  },
  heroLineB: {
    fontFamily: fonts.serifLight,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -0.8,
    color: colors.ink,
  },
  heroLineBAccent: {
    fontFamily: fonts.serifMedium,
    color: colors.emeraldDeep,
  },

  lede: {
    ...typography.body,
    color: colors.textBody,
    maxWidth: 360,
  },

  providerCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  providerEyebrow: { ...typography.labelSmall, color: colors.textMute },
  providerValue: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.ink,
  },
  providerNote: {
    ...typography.caption,
    color: colors.textMute,
    marginTop: 2,
  },

  errorBlock: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorLabel: { ...typography.labelSmall, color: colors.danger },
  errorBody: { ...typography.caption, color: colors.danger, marginTop: 4 },

  footer: { padding: spacing.xl, gap: spacing.md },
  cta: {
    backgroundColor: colors.ink,
    paddingVertical: 18,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { backgroundColor: colors.inkSoft },
  ctaDisabled: { opacity: 0.6 },
  ctaLabel: {
    color: colors.textOnInk,
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  tos: {
    ...typography.caption,
    color: colors.textMute,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
