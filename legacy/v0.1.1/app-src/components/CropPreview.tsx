import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

// 仕様書 §3.7.1 SNSシェア編集画面 — クロッププレビュー
// 枠固定 + 画像をピンチ/パンで移動

export interface CropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CropPreviewProps {
  imageUri: string;
  aspectRatio: number;
  frameWidth: number;
  onCropChange?: (region: CropRegion) => void;
  badge?: React.ReactNode;
  badgeScale?: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const BORDER_W = 2;        // 黒い枠線の太さ
const OUTER_PAD = 8;       // 枠の外側の白余白
const CORNER_LEN = 28;     // L字マークの腕の長さ
const CORNER_W = 4;        // L字マークの太さ
const CORNER_COLOR = '#1A1A1A';

export default function CropPreview({
  imageUri,
  aspectRatio,
  frameWidth,
  onCropChange,
  badge,
  badgeScale = 1,
}: CropPreviewProps) {
  const frameHeight = frameWidth / aspectRatio;

  const imgNaturalW = useSharedValue(1);
  const imgNaturalH = useSharedValue(1);
  const baseW = useSharedValue(frameWidth);
  const baseH = useSharedValue(frameHeight);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const handleImageLoad = useCallback((e: { nativeEvent: { source: { width: number; height: number } } }) => {
    const { width: nw, height: nh } = e.nativeEvent.source;
    imgNaturalW.value = nw;
    imgNaturalH.value = nh;
    const imgAspect = nw / nh;
    const frameAspect = frameWidth / frameHeight;
    if (imgAspect > frameAspect) {
      baseH.value = frameHeight;
      baseW.value = frameHeight * imgAspect;
    } else {
      baseW.value = frameWidth;
      baseH.value = frameWidth / imgAspect;
    }
  }, [frameWidth, frameHeight]);

  const clampTranslation = (tx: number, ty: number, s: number) => {
    'worklet';
    const imgW = baseW.value * s;
    const imgH = baseH.value * s;
    const maxX = Math.max(0, (imgW - frameWidth) / 2);
    const maxY = Math.max(0, (imgH - frameHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, tx)),
      y: Math.min(maxY, Math.max(-maxY, ty)),
    };
  };

  const emitCropRegion = useCallback((tx: number, ty: number, s: number, bw: number, bh: number, nw: number, nh: number) => {
    // bw, bh = cover表示の基本サイズ（scale=1時）
    // nw, nh = ソース画像のピクセルサイズ
    // 表示上の画像サイズ
    const displayW = bw * s;
    const displayH = bh * s;
    // 枠の左上が表示画像上のどこにあるか
    const frameLeftInDisplay = (displayW - frameWidth) / 2 - tx;
    const frameTopInDisplay = (displayH - frameHeight) / 2 - ty;
    // 表示→ソースピクセルへの変換比率
    const ratioX = nw / displayW;
    const ratioY = nh / displayH;
    // ソース画像ピクセル座標に正規化（0〜1）
    const cropX = frameLeftInDisplay * ratioX;
    const cropY = frameTopInDisplay * ratioY;
    const cropW = frameWidth * ratioX;
    const cropH = frameHeight * ratioY;
    onCropChange?.({
      x: cropX / nw,
      y: cropY / nh,
      w: cropW / nw,
      h: cropH / nh,
    });
  }, [frameWidth, frameHeight, onCropChange]);

  const pan = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      const clamped = clampTranslation(
        savedTranslateX.value + e.translationX,
        savedTranslateY.value + e.translationY,
        scale.value,
      );
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      runOnJS(emitCropRegion)(
        translateX.value, translateY.value, scale.value,
        baseW.value, baseH.value,
        imgNaturalW.value, imgNaturalH.value,
      );
    });

  const pinch = Gesture.Pinch()
    .onStart(() => { savedScale.value = scale.value; })
    .onUpdate((e) => {
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
      scale.value = newScale;
      const clamped = clampTranslation(translateX.value, translateY.value, newScale);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      runOnJS(emitCropRegion)(
        translateX.value, translateY.value, scale.value,
        baseW.value, baseH.value,
        imgNaturalW.value, imgNaturalH.value,
      );
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  const imageStyle = useAnimatedStyle(() => ({
    width: baseW.value * scale.value,
    height: baseH.value * scale.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  // 外枠全体サイズ（白パディング + 黒ボーダー + 画像）
  const outerW = frameWidth + (BORDER_W + OUTER_PAD) * 2;
  const outerH = frameHeight + (BORDER_W + OUTER_PAD) * 2;

  return (
    <View style={[styles.outerWrap, { width: outerW, height: outerH }]}>
      {/* 黒ボーダー */}
      <View style={styles.borderWrap}>
        {/* 画像クリップ領域 */}
        <View style={[styles.clipContainer, { width: frameWidth, height: frameHeight }]}>
          <GestureHandlerRootView style={styles.frame}>
            <GestureDetector gesture={gesture}>
              <Animated.View style={styles.gestureArea}>
                <Animated.Image
                  source={{ uri: imageUri }}
                  style={[styles.image, imageStyle]}
                  resizeMode="cover"
                  onLoad={handleImageLoad as any}
                />
              </Animated.View>
            </GestureDetector>

            {/* バッジ */}
            {badge && (
              <View
                style={[styles.badgeContainer, { transform: [{ scale: badgeScale }] }]}
                pointerEvents="none"
              >
                {badge}
              </View>
            )}
          </GestureHandlerRootView>
        </View>
      </View>

      {/* コーナーマーク — ボーダーの外側角に配置 */}
      <CornerMarks />
    </View>
  );
}

/** 四隅のL字マーク — outerWrap の角に配置 */
function CornerMarks() {
  const o = OUTER_PAD - CORNER_W / 2; // ボーダー外端に揃える
  return (
    <>
      {/* 左上 */}
      <View style={[styles.cornerH, { top: o, left: o }]} />
      <View style={[styles.cornerV, { top: o, left: o }]} />
      {/* 右上 */}
      <View style={[styles.cornerH, { top: o, right: o }]} />
      <View style={[styles.cornerV, { top: o, right: o }]} />
      {/* 左下 */}
      <View style={[styles.cornerH, { bottom: o, left: o }]} />
      <View style={[styles.cornerV, { bottom: o, left: o }]} />
      {/* 右下 */}
      <View style={[styles.cornerH, { bottom: o, right: o }]} />
      <View style={[styles.cornerV, { bottom: o, right: o }]} />
    </>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    position: 'relative',
  },
  borderWrap: {
    flex: 1,
    margin: OUTER_PAD,
    borderWidth: BORDER_W,
    borderColor: '#1A1A1A',
  },
  clipContainer: {
    overflow: 'hidden',
  },
  frame: {
    flex: 1,
  },
  gestureArea: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    position: 'absolute',
  },
  badgeContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    transformOrigin: 'bottom right',
  },
  cornerH: {
    position: 'absolute',
    width: CORNER_LEN,
    height: CORNER_W,
    backgroundColor: CORNER_COLOR,
  },
  cornerV: {
    position: 'absolute',
    width: CORNER_W,
    height: CORNER_LEN,
    backgroundColor: CORNER_COLOR,
  },
});
