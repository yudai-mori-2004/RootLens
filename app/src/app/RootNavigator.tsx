import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { navigationHeaderOptions } from '../theme';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { CaptureScreen } from '../screens/CaptureScreen';
import {
  DEFAULT_CAPTURE_SETTINGS,
  loadCaptureSettings,
  subscribeCaptureSettings,
} from '../services/captureSettings';

const Stack = createNativeStackNavigator<RootStackParamList>();

// 起動は常に MainTabs (= 起動時のゲートは置かない)。
//
// ログインは起動のゲートにしない: 撮影は完全ローカルで、 アカウントが
// 必要なのはアップロード + 同意記録の瞬間だけ。 オフラインの現場でトークン復元に失敗しても
// 撮影は止めない。 Login はアップロード時 / 設定 / 発行 QR のディープリンクから開く。
// 利用規約への同意はアップロード同意ポップ (ClipPreviewModal) がクリップごとに取る。
//
// CaptureMode は MainTabs の上に push する fullscreen modal。

export const RootNavigator: React.FC = () => {
  const [displayOrientation, setDisplayOrientation] = useState(
    DEFAULT_CAPTURE_SETTINGS.displayOrientation,
  );

  useEffect(() => {
    let active = true;
    loadCaptureSettings()
      .then((settings) => {
        if (active) setDisplayOrientation(settings.displayOrientation);
      })
      .catch(() => {});
    const unsubscribe = subscribeCaptureSettings((settings) => {
      setDisplayOrientation(settings.displayOrientation);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const nativeOrientation = displayOrientation === 'landscapeLeft'
    ? 'landscape_left' as const
    : 'landscape_right' as const;

  return (
    <Stack.Navigator
      initialRouteName="Main"
      // アプリ全体とカメラの向きを同じ保存設定から決める。 設定変更時は navigator も即座に
      // 180° 回転し、 撮影画面へ入った時だけ向きが変わる状態を作らない。
      screenOptions={{ ...navigationHeaderOptions, orientation: nativeOrientation }}
    >
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="CaptureMode"
        component={CaptureScreen}
        // CaptureMode も navigator と同じ保存設定へ固定する。 native camera backend には
        // CaptureScreen が同じ DisplayOrientation を session 起動前に渡す。
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          orientation: nativeOrientation,
          animation: 'none',
        }}
      />
    </Stack.Navigator>
  );
};
