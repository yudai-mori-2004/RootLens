import 'react-native-get-random-values';
import 'fast-text-encoding';

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Fraunces_300Light,
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';

import HomeScreen from './src/sandboxes/HomeScreen';
import { sandboxes } from './src/sandboxes/registry';
import { useCertificateProvisioning } from './src/hooks/useCertificateProvisioning';

export type SandboxStackParamList = {
  Home: undefined;
} & { [K in string]: undefined };

const Stack = createNativeStackNavigator<SandboxStackParamList>();

// app 全体の color theme (white-based + navy accent)。
// React Navigation の header / background も合わせる。
const appNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#fafaf7',
    card: '#ffffff',
    border: '#dcd8d0',
    primary: '#0a1f44',
    text: '#0a1f44',
  },
};

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_300Light,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf7' }}>
        <ActivityIndicator color="#0a1f44" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <CertGate>
        <NavigationContainer theme={appNavTheme}>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: '#ffffff' },
              headerTintColor: '#0a1f44',
              headerTitleStyle: {
                fontFamily: 'Fraunces_500Medium',
                fontSize: 17,
                color: '#0a1f44',
              },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: '#fafaf7' },
            }}
          >
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ title: 'RootLens' }}
            />
            {sandboxes.map((s) => (
              <Stack.Screen
                key={s.id}
                name={s.id}
                component={s.screen}
                options={{ title: 'RootLens' }}
              />
            ))}
          </Stack.Navigator>
          <StatusBar style="dark" />
        </NavigationContainer>
      </CertGate>
    </SafeAreaProvider>
  );
}

/**
 * 起動時の Device Certificate プロビジョニングをブロックゲートにする。
 *   - checking / provisioning : 全画面スピナー (UI ブロック)
 *   - ready / renewing       : children を描画 (renewing は background)
 *   - error                  : DEV では透過、本番ではエラー UI + リトライ
 */
const CertGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cert = useCertificateProvisioning();

  if (cert.status === 'checking' || cert.status === 'provisioning') {
    return (
      <View style={gateStyles.center}>
        <ActivityIndicator color="#0a1f44" />
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
  // renewing 中の subtle indicator が欲しければ children の上に薄い banner を載せる手もある。
  return <>{children}</>;
};

const gateStyles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#fafaf7',
  },
  eyebrow: {
    fontFamily: 'Menlo',
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: '600',
    color: '#5a6b7c',
    marginTop: 16,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1a2940',
    textAlign: 'center',
    maxWidth: 320,
  },
  retry: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 4,
    backgroundColor: '#0a1f44',
  },
  retryLabel: {
    color: '#fafaf7',
    fontFamily: 'Fraunces_500Medium',
    fontSize: 14,
    letterSpacing: 0.2,
  },
});
