import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import type { WearerHandObservation } from '../native/arkitCapture';

// 撮影前のフレーミング確認用オーバーレイ。
//
// 装着者の手のランドマーク (21 点 × 左右最大 2 つ) を、 画面の中央 60% 領域の枠と一緒に描く。
//
// 座標規約:
//   - landmark は ARKit 側で正立済 image (= display orientation) の 0..1 normalized 座標。
//   - そのまま x*width / y*height で描くと、 PreviewView が aspect-fill (= 中央に合わせて
//     overscan + clip) しているため、 view の中で実際に映っている image は中央矩形のみ。
//     normalized landmark を view 全体に対して掛けると映像と座標がズレ歪んで見える。
//   - 解決: image aspect (imageWidth / imageHeight) と view aspect から image-in-view rect を
//     算出し、 その rect 内で landmark を描く。
//
// imageWidth / imageHeight は HandTrack event から渡ってくる、 sensor 解像度を display orientation
// に変換した値 (= ARKit 側 で .right / .up / .down の orientation を経由した値)。

interface Props {
  width: number;
  height: number;
  hands: WearerHandObservation[];
  wellFramed: boolean;
  imageWidth: number;   // landmark の参照する image 幅 (= display orientation 後)
  imageHeight: number;  // landmark の参照する image 高さ (= display orientation 後)
}

const FINGER_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

/// view と image の aspect 差を埋めて image-in-view rect (= 実際に映像が描画されている矩形) を返す。
/// PreviewView が aspect-fill (= cover) で描画しているのと同じ規約。
function imageRectInView(
  viewW: number, viewH: number,
  imgW: number, imgH: number,
): { x: number; y: number; w: number; h: number } {
  if (imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: viewW, h: viewH };
  const viewAR = viewW / viewH;
  const imgAR = imgW / imgH;
  if (viewAR > imgAR) {
    // view の方が wide。 width を合わせて height 超過。
    const scale = viewW / imgW;
    const scaledH = imgH * scale;
    return { x: 0, y: (viewH - scaledH) / 2, w: viewW, h: scaledH };
  } else {
    const scale = viewH / imgH;
    const scaledW = imgW * scale;
    return { x: (viewW - scaledW) / 2, y: 0, w: scaledW, h: viewH };
  }
}

export const CaptureHandOverlay: React.FC<Props> = ({ width, height, hands, wellFramed, imageWidth, imageHeight }) => {
  const rect = imageRectInView(width, height, imageWidth, imageHeight);

  // 中央 60% safe zone は VIEW 全体ではなく IMAGE rect の内側 8% 余白で描く
  // (= HandTracker.frameSafeMargin と一致、 ランドマークと同じ座標系)
  const pad = 0.08;
  const boxX = rect.x + pad * rect.w;
  const boxY = rect.y + pad * rect.h;
  const boxW = (1 - 2 * pad) * rect.w;
  const boxH = (1 - 2 * pad) * rect.h;
  const boxColor = wellFramed ? '#1FA679' : 'rgba(255,255,255,0.5)';

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      <Svg width={width} height={height}>
        <Rect
          x={boxX}
          y={boxY}
          width={boxW}
          height={boxH}
          stroke={boxColor}
          strokeWidth={2}
          fill="none"
        />

        {hands.map((hand, hi) => (
          <React.Fragment key={hi}>
            {FINGER_CONNECTIONS.map(([a, b], ci) => {
              const p1 = hand.landmarks[a];
              const p2 = hand.landmarks[b];
              if (!p1 || !p2 || p1.confidence < 0.3 || p2.confidence < 0.3) return null;
              return (
                <Line
                  key={`l-${hi}-${ci}`}
                  x1={rect.x + p1.x * rect.w}
                  y1={rect.y + p1.y * rect.h}
                  x2={rect.x + p2.x * rect.w}
                  y2={rect.y + p2.y * rect.h}
                  stroke="rgba(31,166,121,0.85)"
                  strokeWidth={2}
                />
              );
            })}
            {hand.landmarks.map((lm, li) => {
              if (lm.confidence < 0.3) return null;
              const isWrist = li === 0;
              return (
                <Circle
                  key={`c-${hi}-${li}`}
                  cx={rect.x + lm.x * rect.w}
                  cy={rect.y + lm.y * rect.h}
                  r={isWrist ? 5 : 3}
                  fill={isWrist ? '#E8B339' : '#1FA679'}
                />
              );
            })}
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
};
