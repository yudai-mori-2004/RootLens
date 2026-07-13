// LP (rootlens.io / パンフレット) の背景を移植する:
//   • 紫黒のグラデ (linear 160deg 相当) の上に、
//   • 3 つの色付き radial glow (cyan 左上・purple 右中・pink 左下)、
//   • ドットの grain 層 (規則的な淡いドット)。
// SVG を absolute で敷き、 触れないので pointerEvents は殺す。
// 画面サイズに合わせて再描画するため useWindowDimensions で 100% にする。

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, {
  Defs, RadialGradient as SvgRadial, Stop, Rect, Pattern, Circle, LinearGradient, G,
} from 'react-native-svg';

export const BackgroundGlow: React.FC = () => {
  const { width, height } = useWindowDimensions();

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          {/* ベースの紫黒グラデ */}
          <LinearGradient id="base" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#1d0736" />
            <Stop offset="55%" stopColor="#170529" />
            <Stop offset="100%" stopColor="#12021f" />
          </LinearGradient>
          {/* 左上のシアン glow */}
          <SvgRadial id="cyan" cx="8%" cy="30%" rx="35%" ry="55%" fx="8%" fy="30%">
            <Stop offset="0%" stopColor="#00E5FF" stopOpacity="0.16" />
            <Stop offset="70%" stopColor="#00E5FF" stopOpacity="0" />
          </SvgRadial>
          {/* 右中央のパープル glow (LP で一番強い光) */}
          <SvgRadial id="purple" cx="96%" cy="46%" rx="45%" ry="60%" fx="96%" fy="46%">
            <Stop offset="0%" stopColor="#8B3DFF" stopOpacity="0.22" />
            <Stop offset="70%" stopColor="#8B3DFF" stopOpacity="0" />
          </SvgRadial>
          {/* 左下のピンク glow */}
          <SvgRadial id="pink" cx="12%" cy="88%" rx="40%" ry="55%" fx="12%" fy="88%">
            <Stop offset="0%" stopColor="#FF2E93" stopOpacity="0.16" />
            <Stop offset="70%" stopColor="#FF2E93" stopOpacity="0" />
          </SvgRadial>
          {/* grain: 3px 間隔の淡いドット */}
          <Pattern id="grain" x="0" y="0" width="3" height="3" patternUnits="userSpaceOnUse">
            <Circle cx="0.5" cy="0.5" r="0.4" fill="rgba(255,255,255,0.045)" />
          </Pattern>
        </Defs>
        <Rect width={width} height={height} fill="url(#base)" />
        <G>
          <Rect width={width} height={height} fill="url(#cyan)" />
          <Rect width={width} height={height} fill="url(#purple)" />
          <Rect width={width} height={height} fill="url(#pink)" />
          <Rect width={width} height={height} fill="url(#grain)" opacity="0.5" />
        </G>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
});
