import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { navigationHeaderOptions } from '../theme';

import { LoginScreen } from '../screens/LoginScreen';
import { TaskListScreen } from '../screens/TaskListScreen';
import { CaptureScreen } from '../screens/CaptureScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { SignAndMintScreen } from '../screens/SignAndMintScreen';
import { StakeScreen } from '../screens/StakeScreen';
import { DoneScreen } from '../screens/DoneScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => (
  <Stack.Navigator screenOptions={navigationHeaderOptions}>
    <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'RootLens' }} />
    <Stack.Screen name="TaskList" component={TaskListScreen} options={{ title: 'Pick a task' }} />
    <Stack.Screen
      name="Capture"
      component={CaptureScreen}
      options={{ title: 'Record', headerShown: false }}
    />
    <Stack.Screen name="Review" component={ReviewScreen} options={{ title: 'Review' }} />
    <Stack.Screen name="SignAndMint" component={SignAndMintScreen} options={{ title: 'Mint' }} />
    <Stack.Screen name="Stake" component={StakeScreen} options={{ title: 'Stake' }} />
    <Stack.Screen
      name="Done"
      component={DoneScreen}
      options={{ title: 'Done', headerBackVisible: false }}
    />
  </Stack.Navigator>
);
