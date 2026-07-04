import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { colors, navigationHeaderOptions } from '../theme';
import { useAuth } from '../services/auth';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { CaptureScreen } from '../screens/CaptureScreen';
import { OnboardingScreen, isOnboardingCompleted } from '../screens/OnboardingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// 起動時の判定:
//   onboarding 未完了        → Onboarding screen (ウェルカム + ToS)
//   onboarding 済 + 未認証   → Login screen
//   onboarding 済 + 認証済   → MainTabs
//
// CaptureMode は MainTabs の上に push する fullscreen modal (UI_SPECS §4 + §5)。

export const RootNavigator: React.FC = () => {
  const { state } = useAuth();
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

  if (state.status === 'loading' || !onboardingChecked) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const initialRoute: keyof RootStackParamList =
    !onboardingDone ? 'Onboarding' :
    state.status === 'authenticated' ? 'Main' : 'Login';

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{ ...navigationHeaderOptions, orientation: 'portrait' }}
    >
      <Stack.Screen name="Onboarding" options={{ headerShown: false }}>
        {({ navigation }) => (
          <OnboardingScreen
            onCompleted={() => {
              setOnboardingDone(true);
              navigation.replace(state.status === 'authenticated' ? 'Main' : 'Login');
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="CaptureMode"
        component={CaptureScreen}
        // 撮影画面だけ横向き固定。 react-native-screens がネイティブで強制する (= expo-screen-orientation
        // の lockAsync は react-native-screens に上書きされ効かないため、 こちらが正攻法)。
        // ⚠ 映像が上下逆なら 'landscape_right' → 'landscape_left' に。
        // animation:'none' = 退場アニメと向き変更が競合して「横のまま戻って 0.5s 後に縦」 とフラッシュ
        // するのを防ぐ (= アニメを切ると向きが即座に切り替わる。 既知の rns 挙動への定番回避)。
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
