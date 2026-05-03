import 'react-native-get-random-values';
import 'fast-text-encoding';

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/sandboxes/HomeScreen';
import { sandboxes } from './src/sandboxes/registry';

export type SandboxStackParamList = {
  Home: undefined;
} & { [K in string]: undefined };

const Stack = createNativeStackNavigator<SandboxStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'RootLens v0.1.2 Sandboxes' }}
          />
          {sandboxes.map((s) => (
            <Stack.Screen
              key={s.id}
              name={s.id}
              component={s.screen}
              options={{ title: s.title }}
            />
          ))}
        </Stack.Navigator>
        <StatusBar style="auto" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
