import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { View, ViewProps } from 'react-native';

// 抽象センサー層 — 撮影中ライブプレビュー View ラッパー (Plan C)
//
// ネイティブ実装は app/modules/sensor-session/{ios,android}/PreviewView。
// Phase 2 では描画 + lifecycle のみ。zoom/focus/orientation/flash UX は Task 05 で追加。

type Props = ViewProps;

// Expo Modules では Module 単位に1個の View が登録され、view manager 名は
// Module 名 ('SensorSession') になる。
let NativeView: React.ComponentType<Props> | null = null;
try {
  NativeView = requireNativeViewManager<Props>('SensorSession');
} catch {
  NativeView = null;
}

export const SensorPreviewView: React.FC<Props> = (props) => {
  if (!NativeView) {
    // ネイティブモジュール未ビルド時のフォールバック (色つきプレースホルダ)
    return <View {...props} style={[{ backgroundColor: '#000' }, props.style]} />;
  }
  return <NativeView {...props} />;
};
