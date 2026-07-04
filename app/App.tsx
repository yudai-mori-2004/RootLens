import 'react-native-get-random-values';
import 'fast-text-encoding';

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Fraunces_300Light,
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import { RootNavigator } from './src/app/RootNavigator';
import { DevSandboxScreen } from './src/devsandbox/DevSandboxScreen';
import { AuthGate } from './src/services/auth';
import { colors } from './src/theme';
import { USE_DEV_SANDBOX } from './src/env';
import { initClipPersistence } from './src/clips/persistence';
import { initLocale } from './src/i18n';

// 起点は既定で本番 UI (RootNavigator)。 EXPO_PUBLIC_USE_SANDBOX=1 の時だけ dataflow sandbox を起点にする。
// (= dataflow 層の単体検証ハーネス。 本番フローはこれと同じ dataflow を呼ぶ別の Layer-3 消費者)

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
    Fraunces_700Bold,
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
      </AuthGate>
    </SafeAreaProvider>
  );
}

// initialRouteForApp は廃止 (= RootNavigator が AuthGate の useAuth() で判定する)。

const styles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 12, backgroundColor: colors.paper,
  },
});
