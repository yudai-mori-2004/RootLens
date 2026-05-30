import 'react-native-get-random-values';
import 'fast-text-encoding';

import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Fraunces_300Light,
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import { RootNavigator } from './src/app/RootNavigator';
import { DevSandboxScreen } from './src/devsandbox/DevSandboxScreen';
import { useCertificateProvisioning } from './src/hooks/useCertificateProvisioning';
import { AuthGate } from './src/services/auth';
// 2026-05-27 撤去: voicePref / voiceAgent / sherpa-onnx 系は段階削除済み
import { colors, fonts, typography } from './src/theme';
import { USE_DEV_SANDBOX } from './src/env';
import { initClipPersistence } from './src/clips/persistence';
import { initLocale, useT } from './src/i18n';

// 起点は既定で本番 UI (RootNavigator)。 EXPO_PUBLIC_USE_SANDBOX=1 の時だけ dataflow sandbox を起点にする。
// (= dataflow 層の単体検証ハーネス。 本番フローはこれと同じ dataflow を呼ぶ別の Layer-3 消費者)

// 統合フェーズ entry point。
// CertGate (Unit A の TEE 証明書プロビジョニング) を起動時に解決してから
// RootNavigator (Login/Main + 撮影フロー) に入る。

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.paper,
    card: colors.paper,
    border: colors.border,
    primary: colors.ink,
    text: colors.ink,
  },
};

export default function App() {
  // 画面の向きは RootNavigator の native-stack `orientation` オプションが screen 単位で管理する
  // (= タブ portrait、 撮影だけ landscape)。 expo-screen-orientation の lockAsync は
  // react-native-screens に上書きされ効かないので、 ここでは扱わない。
  const [localeReady, setLocaleReady] = React.useState(false);
  useEffect(() => {
    // クリップ永続化 (= Layer 2 アダプタ) を起動: 保存済みクリップを hydrate + 以降の変更を persist。
    initClipPersistence().catch(() => {});
    // 保存済み locale を hydrate してから描画 (= 既定 locale のちらつきを防ぐ)。
    initLocale().finally(() => setLocaleReady(true));
  }, []);

  const [fontsLoaded] = useFonts({
    Fraunces_300Light,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded || !localeReady) {
    return (
      <View style={[styles.center, { backgroundColor: colors.paper }]}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthGate>
        <CertGate>
          {USE_DEV_SANDBOX ? (
            <>
              <DevSandboxScreen />
              <StatusBar style="light" />
            </>
          ) : (
            <NavigationContainer theme={navTheme}>
              <RootNavigator />
              <StatusBar style="dark" />
            </NavigationContainer>
          )}
        </CertGate>
      </AuthGate>
    </SafeAreaProvider>
  );
}

/**
 * 起動時の Device Certificate プロビジョニング (Unit A) をブロックゲートにする。
 * checking / provisioning は全画面スピナー、ready / renewing は children を描画。
 * error は DEV では透過、本番では retry UI。
 */
const CertGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cert = useCertificateProvisioning();
  const t = useT();

  if (cert.status === 'checking' || cert.status === 'provisioning') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ink} />
        <Text style={[styles.eyebrow, { marginTop: 16 }]}>{t('app.deviceCertificate')}</Text>
        <Text style={styles.body}>
          {cert.status === 'checking' ? t('app.checking') : t('app.provisioning')}
        </Text>
      </View>
    );
  }

  if (cert.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.eyebrow}>{t('app.setupFailed')}</Text>
        <Text style={styles.body} numberOfLines={4}>
          {cert.error ?? t('app.unknownError')}
        </Text>
        <Pressable style={styles.retry} onPress={cert.retry}>
          <Text style={styles.retryLabel}>{t('app.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  // ready / renewing は children に passthrough
  return <>{children}</>;
};

// initialRouteForApp は廃止 (= RootNavigator が AuthGate の useAuth() で判定する)。

const styles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 12, backgroundColor: colors.paper,
  },
  eyebrow: { ...typography.label, color: colors.textMute },
  body: {
    ...typography.body, color: colors.textInk,
    textAlign: 'center', maxWidth: 320,
  },
  retry: {
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: 8, backgroundColor: colors.ink,
  },
  retryLabel: {
    color: colors.textOnInk, fontSize: 14,
    fontFamily: fonts.sansSemibold,
  },
});
