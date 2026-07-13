// ログイン画面。
//
// 起動のゲートではない: アップロード時の誘導 / 設定 / 発行 QR のディープリンクから開く。
// SupabaseAuthProvider: 運営発行の ID (= handle) + パスワードでログインする。
// 発行 QR (io.rootlens.app://login?id=..&pw=..) を iOS カメラで読むとディープリンクで
// この画面が開き、 資格情報が自動入力されてそのままログインする。
// DebugAuthProvider (= ローカル検証): 従来どおり「サインイン」 押下で即 authenticated。
//
// レイアウトはアプリ全体と同じ横持ち (landscape) 前提の 2 カラム:
// 左 = ブランド + ワンライナー (LP と同じ)、 右 = 資格情報カード + CTA (スクロール可)。

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';

import type { RootStackParamList } from '../app/types';
import { BrandMark } from '../components/BrandMark';
import { useAuth } from '../services/auth';
import { useT } from '../i18n';
import { colors, fonts, radii, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { provider } = useAuth();
  const t = useT();
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');

  const supportsPassword = typeof provider.loginWithPassword === 'function';

  // 成功したら元の画面に戻る。 QR ディープリンクの冷起動でこの画面が初期画面の場合は Main へ。
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
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.replace('Main');
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoggingIn(false);
      }
    },
    [provider, supportsPassword, navigation],
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.columns}>
          {/* ── 左: ブランド + ワンライナー ── */}
          <View style={styles.left}>
            <View style={styles.markRow}>
              <BrandMark size={26} />
            </View>
            <View style={styles.heroBlock}>
              <Text style={styles.heroLine}>{t('login.heroLineA')}</Text>
              <Text style={styles.heroLine}>
                {t('login.heroBPrefix')}
                <Text style={styles.heroAccent}>{t('login.heroBAccent')}</Text>
                {t('login.heroBSuffix')}
              </Text>
            </View>
            <Text style={styles.lede}>{t('login.lede')}</Text>
          </View>

          {/* ── 右: 資格情報 + CTA ── */}
          <ScrollView
            style={styles.right}
            contentContainerStyle={styles.rightContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
                <Text style={styles.providerNote}>{t('login.providerNote')}</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBlock}>
                <Text style={styles.errorLabel}>{t('login.signInFailed')}</Text>
                <Text style={styles.errorBody}>{error}</Text>
              </View>
            )}

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
            <Text style={styles.tos}>{t('login.tos')}</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* 閉じる (= push されて来た場合のみ。 スワイプバックの代替) */}
      {navigation.canGoBack() && (
        <Pressable
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.5 }]}
          onPress={() => navigation.goBack()}
          hitSlop={12}
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },

  columns: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
  },

  left: {
    flex: 1,
    gap: spacing.md,
  },
  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  heroBlock: { gap: 2 },
  heroLine: {
    fontFamily: fonts.serifLight,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  heroAccent: {
    fontFamily: fonts.serifMedium,
    color: colors.lpPink,
  },
  lede: {
    ...typography.body,
    color: colors.textBody,
    maxWidth: 380,
  },

  right: {
    flexGrow: 0,
    width: 380,
    maxHeight: '100%',
  },
  rightContent: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },

  providerCard: {
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
    paddingVertical: 8,
    backgroundColor: colors.paper,
  },
  providerNote: {
    ...typography.caption,
    color: colors.textMute,
    marginTop: 2,
  },

  errorBlock: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorLabel: { ...typography.labelSmall, color: colors.danger },
  errorBody: { ...typography.caption, color: colors.danger, marginTop: 4 },

  cta: {
    backgroundColor: colors.lpPink,
    paddingVertical: 16,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { opacity: 0.85 },
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
  },

  close: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontSize: 18, color: colors.textMute },
});
