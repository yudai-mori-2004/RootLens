import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { navigationHeaderOptions } from '../theme';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { TaskBriefingScreen } from '../screens/TaskBriefingScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { getDemoWalletPubkey } from '../domain/wallet';

const Stack = createNativeStackNavigator<RootStackParamList>();

// 撮影フロー (TaskBriefing → Capture) は MainTabs の上に push する root-stack screen。
// Capture 完了時 (= 「送る」 押下) は popToTop で MainTabs の Collection タブに戻る。
// Review / SignAndMint / Stake / Done は廃止 (= SPECS_JA §2.7、 状態は Collection に統合)。
//
// initialRoute: env に wallet があれば Main 直行、 無ければ Login で wallet 設定を促す。
const initialRoute: 'Main' | 'Login' = getDemoWalletPubkey() ? 'Main' : 'Login';

export const RootNavigator: React.FC = () => (
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
