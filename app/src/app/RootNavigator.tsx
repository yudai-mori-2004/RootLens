import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { colors, navigationHeaderOptions } from '../theme';
import { useAuth } from '../services/auth';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { CaptureModeScreen } from '../screens/CaptureModeScreen';
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
    <Stack.Navigator initialRouteName={initialRoute} screenOptions={navigationHeaderOptions}>
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
        component={CaptureModeScreen}
        options={{ headerShown: false, presentation: 'fullScreenModal' }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
