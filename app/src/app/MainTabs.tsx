import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { MainTabParamList, RootStackParamList } from './types';
import { CollectionScreen as HomeScreen } from '../screens/CollectionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HomeIcon, CameraIcon, SettingsIcon } from '../components/TabIcons';

// Camera タブの screen 本体は何も描画しない (= push trigger 専用)。
// MainTabs は createBottomTabNavigator が screen に component を要求するので、
// 中身が空の placeholder を渡す。
const CameraTabPlaceholder: React.FC = () => null;
import { useT } from '../i18n';
import { colors, fonts, spacing } from '../theme';

// UI_SPECS_JA §2.1 — 3 タブ構造。
//
//   Home (左)     コレクション + ステーキング + 収益 (= 旧 CollectionScreen)
//   Camera (中央) 撮影モード入口。 タップで対話サブモード起動 (= 暫定: タスク選択 modal)
//   Settings (右) アカウント / 通知 / 撮影設定 / データ / サポート
//
// 中央 Camera タブは visual もコードも他 2 タブと差別化:
//   • tabBarButton を custom 化してリング状アイコンを大きく描く
//   • タップで selection ではなく直接 RootStack の TaskBriefing を push
//     (= 「タブ画面」 は実体ではなく action trigger)

const Tab = createBottomTabNavigator<MainTabParamList>();

type RootNav = NativeStackNavigationProp<RootStackParamList>;

const renderLabel = (focused: boolean, label: string) => (
  <Text
    style={[
      styles.tabLabel,
      { color: focused ? colors.ink : colors.textMute },
    ]}
  >
    {label}
  </Text>
);

const CameraTabButton: React.FC<{ children?: React.ReactNode }> = () => {
  const rootNav = useNavigation<RootNav>();
  const t = useT();
  const open = () => {
    // RootStack の CaptureMode を fullscreen modal で push (UI_SPECS §2.2)。
    // タブの Camera screen 自体は dummy で、 描画されない。
    rootNav.navigate('CaptureMode');
  };
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.cameraButton, pressed && styles.cameraButtonPressed]}
      accessibilityRole="button"
      accessibilityLabel={t('tab.captureA11y')}
    >
      <CameraIcon active={false} size={28} />
    </Pressable>
  );
};

export const MainTabs: React.FC = () => {
  const t = useT();
  return (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarStyle: styles.tabBar,
      tabBarItemStyle: styles.tabItem,
      tabBarShowLabel: true,
      tabBarLabelPosition: 'below-icon',
      sceneStyle: { backgroundColor: colors.paper },
    }}
  >
    <Tab.Screen
      name="Home"
      component={HomeScreen}
      options={{
        tabBarIcon: ({ focused }) => (
          <View style={styles.iconWrap}>
            <HomeIcon active={focused} />
          </View>
        ),
        tabBarLabel: ({ focused }) => renderLabel(focused, t('tab.home')),
      }}
    />
    <Tab.Screen
      name="Camera"
      component={CameraTabPlaceholder}
      options={{
        tabBarButton: (props) => <CameraTabButton {...props} />,
        tabBarLabel: () => null,
      }}
    />
    <Tab.Screen
      name="Settings"
      component={SettingsScreen}
      options={{
        tabBarIcon: ({ focused }) => (
          <View style={styles.iconWrap}>
            <SettingsIcon active={focused} />
          </View>
        ),
        tabBarLabel: ({ focused }) => renderLabel(focused, t('tab.settings')),
      }}
    />
  </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    height: Platform.OS === 'ios' ? 88 : 70,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.sm,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabItem: {
    paddingTop: 4,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 2,
  },
  tabLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  cameraButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
  },
  cameraButtonPressed: {
    opacity: 0.7,
  },
});
