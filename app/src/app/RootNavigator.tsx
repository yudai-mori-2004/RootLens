import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { colors, navigationHeaderOptions } from '../theme';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { CaptureScreen } from '../screens/CaptureScreen';
import { OnboardingScreen, isOnboardingCompleted } from '../screens/OnboardingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// 起動時の判定:
//   onboarding 未完了 → Onboarding screen (ウェルカム + ToS)、 済なら MainTabs。
//
// ログインは起動のゲートにしない (2026-07-12 判断): 撮影は完全ローカルで、 アカウントが
// 必要なのはアップロード + 同意記録の瞬間だけ。 オフラインの現場でトークン復元に失敗しても
// 撮影は止めない。 Login はアップロード時 / 設定 / 発行 QR のディープリンクから開く。
//
// CaptureMode は MainTabs の上に push する fullscreen modal (UI_SPECS §4 + §5)。

export const RootNavigator: React.FC = () => {
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const done = await isOnboardingCompleted();
      if (!cancelled) {
        setOnboardingDone(done);
        setOnboardingChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!onboardingChecked) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const initialRoute: keyof RootStackParamList = !onboardingDone ? 'Onboarding' : 'Main';

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      // v0.1.4: アプリ全体を横持ちベースにする (= 常に landscape 動画を撮る前提の UI)。
      // 撮影画面が landscape_right 固定なので、 他画面も同じ向きに固定する (= タブで逆さに持って
      // いた人が撮影に入ると UI が 180° 回る、 を無くす。 2026-07-06 判断)。
      screenOptions={{ ...navigationHeaderOptions, orientation: 'landscape_right' }}
    >
      <Stack.Screen name="Onboarding" options={{ headerShown: false }}>
        {({ navigation }) => (
          <OnboardingScreen
            onCompleted={() => {
              setOnboardingDone(true);
              navigation.replace('Main');
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="CaptureMode"
        component={CaptureScreen}
        // 撮影画面は landscape_right に固定 (= native カメラ frame の向きと一致させる)。
        // 他画面は landscape (左右どちらも可)。 react-native-screens がネイティブで強制する。
        // ⚠ 映像が上下逆なら 'landscape_right' → 'landscape_left' に。
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          orientation: 'landscape_right',
          animation: 'none',
        }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
