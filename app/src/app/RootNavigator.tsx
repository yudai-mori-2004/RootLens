import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { navigationHeaderOptions } from '../theme';

import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs } from './MainTabs';
import { CaptureScreen } from '../screens/CaptureScreen';

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
  return (
    <Stack.Navigator
      initialRouteName="Main"
      // アプリ全体を横持ちベースにする (= 常に landscape 動画を撮る前提の UI)。
      // 撮影画面が landscape_right 固定なので、 他画面も同じ向きに固定する (= タブで逆さに持って
      // いた人が撮影に入ると UI が 180° 回る、 を無くす)。
      screenOptions={{ ...navigationHeaderOptions, orientation: 'landscape_right' }}
    >
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="CaptureMode"
        component={CaptureScreen}
        // 撮影画面は landscape_right に固定 (= native カメラ frame の向きと一致させる)。
        // 他画面は landscape (左右どちらも可)。 react-native-screens がネイティブで強制する。
        // ⚠ 映像が上下逆なら 'landscape_right' → 'landscape_left' に。
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          orientation: 'landscape_right',
          animation: 'none',
        }}
      />
    </Stack.Navigator>
  );
};
