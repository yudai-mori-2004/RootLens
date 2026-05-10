import 'react-native-get-random-values';
import 'fast-text-encoding';

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from './src/app/RootNavigator';
import { useCertificateProvisioning } from './src/hooks/useCertificateProvisioning';
import { colors } from './src/theme';

// 統合フェーズ entry point。
// CertGate (Unit A の TEE 証明書プロビジョニング) を起動時に解決してから
// RootNavigator (Login → TaskList → Capture → Review → SignAndMint → Stake → Done) に入る。

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    border: colors.border,
    primary: colors.accent,
    text: colors.textPrimary,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <CertGate>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
          <StatusBar style="dark" />
        </NavigationContainer>
      </CertGate>
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
      <View style={gateStyles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={gateStyles.eyebrow}>DEVICE CERTIFICATE</Text>
        <Text style={gateStyles.body}>
          {cert.status === 'checking' ? 'Checking…' : 'Provisioning…'}
        </Text>
      </View>
    );
  }

  if (cert.status === 'error') {
    return (
      <View style={gateStyles.center}>
        <Text style={gateStyles.eyebrow}>SETUP FAILED</Text>
        <Text style={gateStyles.body} numberOfLines={4}>
          {cert.error ?? 'Unknown error'}
        </Text>
        <Pressable style={gateStyles.retry} onPress={cert.retry}>
          <Text style={gateStyles.retryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  // ready / renewing は children に passthrough。
  return <>{children}</>;
};

const gateStyles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 12, backgroundColor: colors.background,
  },
  eyebrow: {
    fontSize: 11, letterSpacing: 1.6, fontWeight: '600',
    color: colors.textSecondary, marginTop: 16,
  },
  body: {
    fontSize: 14, lineHeight: 20, color: colors.textPrimary,
    textAlign: 'center', maxWidth: 320,
  },
  retry: {
    marginTop: 12,
    paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: 6, backgroundColor: colors.accent,
  },
  retryLabel: { color: colors.white, fontSize: 14, fontWeight: '600' },
});
