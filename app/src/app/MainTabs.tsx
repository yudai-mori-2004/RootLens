import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from './types';
import { JobScreen } from '../screens/JobScreen';
import { CollectionScreen } from '../screens/CollectionScreen';
import { BuyerScreen } from '../screens/BuyerScreen';
// import { SettingsScreen } from '../screens/SettingsScreen'; // 一時的に Buyer simulator に差替中
import { JobIcon, CollectionIcon, SettingsIcon } from '../components/TabIcons';
import { colors, fonts, spacing } from '../theme';

const Tab = createBottomTabNavigator<MainTabParamList>();

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

export const MainTabs: React.FC = () => (
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
      name="Job"
      component={JobScreen}
      options={{
        tabBarIcon: ({ focused }) => (
          <View style={styles.iconWrap}>
            <JobIcon active={focused} />
          </View>
        ),
        tabBarLabel: ({ focused }) => renderLabel(focused, 'JOB'),
      }}
    />
    <Tab.Screen
      name="Collection"
      component={CollectionScreen}
      options={{
        tabBarIcon: ({ focused }) => (
          <View style={styles.iconWrap}>
            <CollectionIcon active={focused} />
          </View>
        ),
        tabBarLabel: ({ focused }) => renderLabel(focused, 'COLLECTION'),
      }}
    />
    {/* デモ用に Settings タブを一時的に Buyer simulator に差し替え。
        本番では SettingsScreen に戻す (= ../screens/SettingsScreen の import を生かす)。 */}
    <Tab.Screen
      name="Settings"
      component={BuyerScreen}
      options={{
        tabBarIcon: ({ focused }) => (
          <View style={styles.iconWrap}>
            <SettingsIcon active={focused} />
          </View>
        ),
        tabBarLabel: ({ focused }) => renderLabel(focused, 'BUYER'),
      }}
    />
  </Tab.Navigator>
);

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
  },
});
