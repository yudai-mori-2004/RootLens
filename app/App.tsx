import 'react-native-get-random-values';
import 'fast-text-encoding';

import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
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
import { useCertificateProvisioning } from './src/hooks/useCertificateProvisioning';
import { AuthGate } from './src/services/auth';
import { colors, fonts, typography } from './src/theme';

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
  // 起動時 baseline: portrait に lock しておく (= 全 screen の既定方向)。
  // 撮影画面だけ task に応じて override し、 unmount で portrait に戻す。
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
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

  if (!fontsLoaded) {
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
          <NavigationContainer theme={navTheme}>
            <RootNavigator />
            <StatusBar style="dark" />
          </NavigationContainer>
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

  if (cert.status === 'checking' || cert.status === 'provisioning') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ink} />
        <Text style={[styles.eyebrow, { marginTop: 16 }]}>DEVICE CERTIFICATE</Text>
        <Text style={styles.body}>
          {cert.status === 'checking' ? 'Checking…' : 'Provisioning…'}
        </Text>
      </View>
    );
  }

  if (cert.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.eyebrow}>SETUP FAILED</Text>
        <Text style={styles.body} numberOfLines={4}>
          {cert.error ?? 'Unknown error'}
        </Text>
        <Pressable style={styles.retry} onPress={cert.retry}>
          <Text style={styles.retryLabel}>Retry</Text>
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
