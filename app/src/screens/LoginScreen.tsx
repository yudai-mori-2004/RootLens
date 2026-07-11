// Login screen (task 13)。
//
// SupabaseAuthProvider: 運営発行の ID (= handle) + パスワードでログインする。
// 発行 QR (io.rootlens.app://login?id=..&pw=..) を iOS カメラで読むとディープリンクで
// この画面が開き、 資格情報が自動入力されてそのままログインする。
// DebugAuthProvider (= ローカル検証): 従来どおり「サインイン」 押下で即 authenticated。

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RootStackParamList } from '../app/types';
import { BrandMark } from '../components/BrandMark';
import { useAuth } from '../services/auth';
import { useT } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { provider, state } = useAuth();
  const t = useT();
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');

  const supportsPassword = typeof provider.loginWithPassword === 'function';

  // すでに authenticated なら Main に飛ぶ (= AuthGate の初期化が間に合った場合)
  useEffect(() => {
    if (state.status === 'authenticated') {
      navigation.replace('Main');
    }
  }, [state.status, navigation]);

  const doLogin = useCallback(
    async (id: string, pw: string) => {
      setLoggingIn(true);
      setError(null);
      try {
        if (supportsPassword) {
          await provider.loginWithPassword!(id.trim(), pw);
        } else {
          await provider.login();
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoggingIn(false);
      }
    },
    [provider, supportsPassword],
  );

  // 発行 QR のディープリンク (= 初回起動 URL とフォアグラウンド中の受信の両方を拾う)。
  const url = Linking.useURL();
  useEffect(() => {
    if (!url || !supportsPassword) return;
    const { hostname, path, queryParams } = Linking.parse(url);
    if (hostname !== 'login' && path !== 'login') return;
    const id = typeof queryParams?.id === 'string' ? queryParams.id : null;
    const pw = typeof queryParams?.pw === 'string' ? queryParams.pw : null;
    if (!id || !pw) return;
    setLoginId(id);
    setPassword(pw);
    void doLogin(id, pw);
  }, [url, supportsPassword, doLogin]);

  const onContinue = () => doLogin(loginId, password);
  const canSubmit = !loggingIn && (!supportsPassword || (loginId.trim().length > 0 && password.length > 0));

  const providerLabel = provider.id === 'debug' ? t('login.debugAccount') : provider.id;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <View style={styles.markRow}>
          <BrandMark size={28} />
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

        {supportsPassword ? (
          <View style={styles.providerCard}>
            <Text style={styles.providerEyebrow}>{t('login.accountEyebrow')}</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('login.idLabel')}</Text>
              <TextInput
                style={styles.fieldInput}
                value={loginId}
                onChangeText={setLoginId}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                editable={!loggingIn}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('login.passwordLabel')}</Text>
              <TextInput
                style={styles.fieldInput}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                secureTextEntry
                editable={!loggingIn}
                onSubmitEditing={onContinue}
              />
            </View>
            <Text style={styles.providerNote}>{t('login.credNote')}</Text>
          </View>
        ) : (
          <View style={styles.providerCard}>
            <Text style={styles.providerEyebrow}>{t('login.accountEyebrow')}</Text>
            <Text style={styles.providerValue}>{providerLabel}</Text>
            <Text style={styles.providerNote}>
              {t('login.providerNote')}
            </Text>
          </View>
        )}

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
            !canSubmit && styles.ctaDisabled,
            pressed && canSubmit && styles.ctaPressed,
          ]}
          onPress={onContinue}
          disabled={!canSubmit}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, justifyContent: 'space-between' },
  body: { padding: spacing.xl, gap: spacing.lg },

  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
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
  field: { gap: 4 },
  fieldLabel: { ...typography.labelSmall, color: colors.textMute },
  fieldInput: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.paper,
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
