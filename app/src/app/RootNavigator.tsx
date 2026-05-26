import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { colors, navigationHeaderOptions } from '../theme';
import { useAuth } from '../services/auth';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { TaskBriefingScreen } from '../screens/TaskBriefingScreen';
import { CaptureScreen } from '../screens/CaptureScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// 撮影フロー (TaskBriefing → Capture) は MainTabs の上に push する root-stack screen。
// Capture 完了時 (= 「送る」 押下) は popToTop で MainTabs の Home タブに戻る。
//
// 起動時は AuthGate が auth state を確定させる:
//   loading           → 全画面 spinner
//   unauthenticated   → Login screen (initialRoute=Login)
//   authenticated     → Main tabs (initialRoute=Main)

export const RootNavigator: React.FC = () => {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const initialRoute: keyof RootStackParamList =
    state.status === 'authenticated' ? 'Main' : 'Login';

  return (
    <Stack.Navigator initialRouteName={initialRoute} screenOptions={navigationHeaderOptions}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="TaskBriefing"
        component={TaskBriefingScreen}
        options={{ title: '', presentation: 'card' }}
      />
      <Stack.Screen
        name="Capture"
        component={CaptureScreen}
        options={{ title: 'Record', headerShown: false, presentation: 'fullScreenModal' }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
