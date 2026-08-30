// メインレイアウト (= 横持ち)。
//
// 横持ち前提なので、 タブは画面右端の縦レール (= 右手の親指が届く位置)。
//   マイビデオ (上) / 撮影 (中央、 ヒーロー) / 設定 (下)
//
// react-navigation の bottom-tabs は使わない (= 2 画面 + 1 アクションだけなので
// 自前の row レイアウト + useState が最小)。 撮影は RootStack の CaptureMode を
// fullscreen modal で push する (= タブ画面ではなく action trigger)。

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import { CollectionScreen } from '../screens/CollectionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HomeIcon, SettingsIcon } from '../components/TabIcons';
import { BackgroundGlow } from '../components/BackgroundGlow';
import { useT } from '../i18n';
import { colors, fonts, spacing } from '../theme';
import {
  DEFAULT_CAPTURE_SETTINGS,
  loadCaptureSettings,
  subscribeCaptureSettings,
  type CaptureSettings,
} from '../services/captureSettings';

type RootNav = NativeStackNavigationProp<RootStackParamList>;
type TabKey = 'home' | 'settings';

const RAIL_WIDTH = 86;

export const MainTabs: React.FC = () => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const rootNav = useNavigation<RootNav>();
  const [tab, setTab] = useState<TabKey>('home');
  const [captureMethod, setCaptureMethod] = useState<CaptureSettings['captureMethodId']>(
    DEFAULT_CAPTURE_SETTINGS.captureMethodId,
  );
  useEffect(() => {
    loadCaptureSettings().then((settings) => setCaptureMethod(settings.captureMethodId)).catch(() => {});
    return subscribeCaptureSettings((settings) => setCaptureMethod(settings.captureMethodId));
  }, []);
  const captureOnPhone = captureMethod !== 'mentra';

  return (
    <View style={styles.root}>
      {/* LP と同じ紫黒 + 色付きグラデ + grain の背景 (= 全画面の下地) */}
      <BackgroundGlow />
      {/* コンテンツ (= 画面は mount したまま表示切替。 スクロール位置等の state を保つ) */}
      <View style={styles.content}>
        <View style={[styles.page, tab !== 'home' && styles.pageHidden]} pointerEvents={tab === 'home' ? 'auto' : 'none'}>
          <CollectionScreen />
        </View>
        <View style={[styles.page, tab !== 'settings' && styles.pageHidden]} pointerEvents={tab === 'settings' ? 'auto' : 'none'}>
          <SettingsScreen />
        </View>
      </View>

      {/* 右レール */}
      <View style={[styles.rail, { width: RAIL_WIDTH + insets.right, paddingRight: insets.right }]}>
        <RailItem
          label={t('tab.home')}
          active={tab === 'home'}
          onPress={() => setTab('home')}
          icon={(active) => <HomeIcon active={active} size={23} />}
        />

        {/* 撮影 (= ヒーロー)。 ink の円 + シャッターリング */}
        <View style={styles.shutterSlot}>
          <Pressable
            onPress={() => rootNav.navigate('CaptureMode')}
            disabled={!captureOnPhone}
            accessibilityRole="button"
            accessibilityLabel={t('tab.captureA11y')}
            accessibilityState={{ disabled: !captureOnPhone }}
            accessibilityHint={!captureOnPhone ? t('tab.captureMentraHint') : undefined}
            style={({ pressed }) => [
              styles.shutter,
              !captureOnPhone && styles.shutterDisabled,
              pressed && captureOnPhone && styles.shutterPressed,
            ]}
          >
            <Svg width={30} height={30} viewBox="0 0 30 30" fill="none">
              <Circle cx={15} cy={15} r={12.5} stroke={colors.paper} strokeWidth={1.8} />
              {/* 中心は LP のピンク (= primary CTA の差し色はアプリ内で 1 系統) */}
              <Circle cx={15} cy={15} r={5.5} fill={colors.lpPink} />
            </Svg>
          </Pressable>
          {!captureOnPhone ? <Text style={styles.externalCaptureLabel}>MENTRA</Text> : null}
        </View>

        <RailItem
          label={t('tab.settings')}
          active={tab === 'settings'}
          onPress={() => setTab('settings')}
          icon={(active) => <SettingsIcon active={active} size={23} />}
        />
      </View>
    </View>
  );
};

const RailItem: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
  icon: (active: boolean) => React.ReactNode;
}> = ({ label, active, onPress, icon }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="tab"
    accessibilityState={{ selected: active }}
    style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    hitSlop={10}
  >
    <View style={[styles.itemIcon, active && styles.itemIconActive]}>{icon(active)}</View>
    <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  content: { flex: 1 },
  page: { ...StyleSheet.absoluteFillObject },
  pageHidden: { opacity: 0, zIndex: -1 },

  rail: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },

  item: { alignItems: 'center', gap: 5 },
  itemPressed: { opacity: 0.55 },
  itemIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIconActive: { backgroundColor: colors.paperDeep },
  itemLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.textMute,
  },
  itemLabelActive: { color: colors.ink },

  shutter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#33271A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
  shutterPressed: { backgroundColor: colors.inkSoft, transform: [{ scale: 0.96 }] },
  shutterDisabled: { opacity: 0.32 },
  shutterSlot: { alignItems: 'center', gap: 5 },
  externalCaptureLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 8,
    letterSpacing: 1.2,
    color: colors.textMute,
  },
});
