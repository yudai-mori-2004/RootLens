import React from 'react';
import { useNavigation } from '@react-navigation/native';
import SwipeGalleryView from '../components/SwipeGalleryView';

// カメラサムネからのコンテンツ選択（1枚表示スワイプ）
export default function CameraGalleryScreen() {
  const navigation = useNavigation();
  return <SwipeGalleryView onClose={() => navigation.goBack()} />;
}
