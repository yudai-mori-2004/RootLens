// Polyfills — must be first
import 'react-native-get-random-values';
import 'fast-text-encoding';
import '@ethersproject/shims';

import React, { useState, useEffect } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { PrivyProvider } from '@privy-io/expo';
import { PrivyElements } from '@privy-io/expo/ui';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import TabNavigator from './src/navigation/TabNavigator';
import CameraScreen from './src/screens/CameraScreen';
import CameraGalleryScreen from './src/screens/CameraGalleryScreen';
import PublishingScreen from './src/screens/PublishingScreen';
import PreviewScreen from './src/screens/PreviewScreen';
import RegistrationScreen from './src/screens/RegistrationScreen';
import InstagramShareScreen from './src/screens/InstagramShareScreen';
import TwitterShareScreen from './src/screens/TwitterShareScreen';
import type { RootStackParamList } from './src/navigation/types';
import { useCertificateProvisioning } from './src/hooks/useCertificateProvisioning';
import { colors, typography, spacing, radii } from './src/theme';
import { t, initLocale } from './src/i18n';

const RootStack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => { initLocale().then(() => setLocaleReady(true)); }, []);

  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  if (!fontsLoaded || !localeReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // PrivyProvider + PrivyElements をルートに1回だけマウント
  // 仕様書 §2.1: ログイン不問でアプリにアクセス可能
  // PrivyProviderは軽量なcontext providerなのでパフォーマンスに影響しない
  // ログインUIの起動は RegistrationScreen 内で useLogin を呼んだ時だけ
  return (
    <PrivyProvider
      appId={process.env.EXPO_PUBLIC_PRIVY_APP_ID || ''}
      clientId={process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID || ''}
      config={{
        embedded: {
          solana: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      <SafeAreaProvider>
        <AppContent />
        <PrivyElements />
      </SafeAreaProvider>
    </PrivyProvider>
  );
}

function AppContent() {
  const cert = useCertificateProvisioning();

  if (cert.status === 'checking' || cert.status === 'provisioning') {
    return (
      <View style={styles.center}>
        <Text style={styles.logo}>RootLens</Text>
        <ActivityIndicator size="small" color={colors.textHint} style={{ marginTop: spacing.lg }} />
        <Text style={styles.statusText}>
          {cert.status === 'checking' ? t('app.checking') : t('app.provisioning')}
        </Text>
      </View>
    );
  }

  if (cert.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.logo}>RootLens</Text>
        <Text style={styles.errorText}>{t('app.provisionError')}</Text>
        <Text style={styles.errorDetail}>{cert.error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={cert.retry}>
          <Text style={styles.retryButtonText}>{t('app.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <RootStack.Navigator>
        <RootStack.Screen
          name="Main"
          component={TabNavigator}
          options={{ headerShown: false }}
        />
        <RootStack.Screen
          name="Camera"
          component={CameraScreen}
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            animation: 'slide_from_bottom',
          }}
        />
        <RootStack.Screen
          name="CameraGallery"
          component={CameraGalleryScreen}
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            animation: 'slide_from_bottom',
          }}
        />
        <RootStack.Screen
          name="Publishing"
          component={PublishingScreen}
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            gestureEnabled: false,
          }}
        />
        <RootStack.Screen
          name="Preview"
          component={PreviewScreen}
          options={{ headerShown: false, presentation: 'fullScreenModal' }}
        />
        <RootStack.Screen
          name="Registration"
          component={RegistrationScreen}
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            gestureEnabled: false,
          }}
        />
        <RootStack.Screen
          name="InstagramShare"
          component={InstagramShareScreen}
          options={{ headerShown: false, presentation: 'modal' }}
        />
        <RootStack.Screen
          name="TwitterShare"
          component={TwitterShareScreen}
          options={{ headerShown: false, presentation: 'modal' }}
        />
      </RootStack.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  logo: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  statusText: {
    marginTop: spacing.sm,
    ...typography.caption,
    color: colors.textHint,
  },
  errorText: {
    marginTop: spacing.xl,
    ...typography.bodyMedium,
    color: colors.error,
  },
  errorDetail: {
    marginTop: spacing.sm,
    ...typography.caption,
    color: colors.textHint,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  retryButton: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
  },
  retryButtonText: {
    color: colors.white,
    ...typography.bodyMedium,
  },
});
