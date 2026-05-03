import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import PublishedGalleryScreen from '../screens/PublishedGalleryScreen';
import DeviceGalleryScreen from '../screens/DeviceGalleryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import type { GalleryStackParamList, TabParamList, RootStackParamList } from './types';
import { colors, typography, spacing, radii, shadows, navigationHeaderOptions } from '../theme';
import { t, addLocaleListener } from '../i18n';

// 仕様書 §3.2 画面構成

const GalleryStack = createNativeStackNavigator<GalleryStackParamList>();

function PublishedGalleryStack() {
  return (
    <GalleryStack.Navigator screenOptions={navigationHeaderOptions}>
      <GalleryStack.Screen
        name="Gallery"
        component={PublishedGalleryScreen}
        options={{ headerShown: false }}
      />
      <GalleryStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('settings.title') }}
      />
    </GalleryStack.Navigator>
  );
}

const Tab = createBottomTabNavigator<TabParamList>();

// 空のプレースホルダー（カメラタブは実際にはモーダルを開く）
function CameraPlaceholder() {
  return <View style={{ flex: 1, backgroundColor: colors.darkBg }} />;
}

// 中央カメラボタン（§3.2: 丸いカメラボタン + ブランドアクセント）
function CameraTabButton({ onPress }: { onPress?: (...args: any[]) => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <TouchableOpacity
      style={styles.cameraButtonOuter}
      onPress={() => navigation.navigate('Camera')}
    >
      <View style={styles.cameraButton}>
        <View style={styles.cameraButtonInner} />
      </View>
    </TouchableOpacity>
  );
}

export default function TabNavigator() {
  const [, forceUpdate] = useState(0);
  useEffect(() => addLocaleListener(() => forceUpdate(n => n + 1)), []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDisabled,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tab.Screen
        name="PublishedTab"
        component={PublishedGalleryStack}
        options={{
          tabBarLabel: t('tab.home'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="CameraTab"
        component={CameraPlaceholder}
        options={{
          tabBarLabel: '',
          tabBarIcon: () => null,
          tabBarButton: (props) => <CameraTabButton />,
        }}
      />
      <Tab.Screen
        name="DeviceGalleryTab"
        component={DeviceGalleryScreen}
        options={{
          tabBarLabel: t('tab.gallery'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'images' : 'images-outline'} size={size} color={color} />
          ),
          headerShown: false,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 88,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  tabBarLabel: {
    ...typography.label,
    marginTop: 2,
  },
  cameraButtonOuter: {
    top: -16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.md,
  },
  cameraButtonInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.white,
  },
});
