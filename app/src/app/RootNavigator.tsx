import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { navigationHeaderOptions } from '../theme';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { CaptureScreen } from '../screens/CaptureScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { SignAndMintScreen } from '../screens/SignAndMintScreen';
import { StakeScreen } from '../screens/StakeScreen';
import { DoneScreen } from '../screens/DoneScreen';
import { getDemoWalletPubkey } from '../domain/wallet';

const Stack = createNativeStackNavigator<RootStackParamList>();

// 撮影フロー (Capture..Done) は Tab の上に被せて push する root-stack screen。
// Done で `popToTop` すると MainTabs の現在タブ (Job) に戻る。
//
// initialRoute: env に wallet があれば Main 直行、無ければ Login で wallet 設定を促す。
const initialRoute: 'Main' | 'Login' = getDemoWalletPubkey() ? 'Main' : 'Login';

export const RootNavigator: React.FC = () => (
  <Stack.Navigator initialRouteName={initialRoute} screenOptions={navigationHeaderOptions}>
    <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
    <Stack.Screen
      name="Capture"
      component={CaptureScreen}
      options={{ title: 'Record', headerShown: false, presentation: 'fullScreenModal' }}
    />
    <Stack.Screen name="Review" component={ReviewScreen} options={{ title: 'Review' }} />
    <Stack.Screen name="SignAndMint" component={SignAndMintScreen} options={{ title: 'Mint' }} />
    <Stack.Screen name="Stake" component={StakeScreen} options={{ title: 'Stake' }} />
    <Stack.Screen
      name="Done"
      component={DoneScreen}
      options={{ headerShown: false }}
    />
  </Stack.Navigator>
);
