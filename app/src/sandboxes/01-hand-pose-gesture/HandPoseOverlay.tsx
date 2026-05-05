import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';
import { HAND_CONNECTIONS, type HandObservation } from '../../native/handPose';

// 21 joint + bone connections の SVG overlay。
//
// 入力 hand.landmarks は image top-left 原点で normalized (0..1)。
// プレビューは AVCaptureVideoPreviewLayer.resizeAspectFill / CameraX FILL_CENTER で
// アスペクト比を保ちつつ親 view を埋めるため、同じ aspect で SVG を上に重ねれば
// 座標系がそのまま一致する。

interface Props {
  hands: HandObservation[];
  /** view 寸法 (px)。SVG 描画用 */
  width: number;
  height: number;
  /** confidence 下限。これ未満の landmark は描画しない */
  minConfidence?: number;
  /** front camera 等で水平反転表示する場合 true */
  mirrored?: boolean;
}

const COLOR_BY_HANDEDNESS: Record<HandObservation['handedness'], string> = {
  left: '#4FC3F7',  // light blue
  right: '#FFB74D', // amber
  unknown: '#BDBDBD',
};

export const HandPoseOverlay: React.FC<Props> = ({
  hands,
  width,
  height,
  minConfidence = 0.3,
  mirrored = false,
}) => {
  if (width <= 0 || height <= 0) return null;
  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0 }}
      pointerEvents="none"
    >
      {hands.map((hand, hi) => {
        const color = COLOR_BY_HANDEDNESS[hand.handedness];
        const px = (n: number) => (mirrored ? (1 - n) * width : n * width);
        const py = (n: number) => n * height;
        return (
          <React.Fragment key={hi}>
            {HAND_CONNECTIONS.map(([a, b], ci) => {
              const la = hand.landmarks[a];
              const lb = hand.landmarks[b];
              if (!la || !lb) return null;
              if (la.confidence < minConfidence || lb.confidence < minConfidence) return null;
              return (
                <Line
                  key={`bone-${hi}-${ci}`}
                  x1={px(la.x)}
                  y1={py(la.y)}
                  x2={px(lb.x)}
                  y2={py(lb.y)}
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.85}
                />
              );
            })}
            {hand.landmarks.map((lm, li) => {
              if (lm.confidence < minConfidence) return null;
              return (
                <Circle
                  key={`joint-${hi}-${li}`}
                  cx={px(lm.x)}
                  cy={py(lm.y)}
                  r={li === 0 ? 6 : 4}
                  fill={color}
                  fillOpacity={0.9}
                />
              );
            })}
          </React.Fragment>
        );
      })}
    </Svg>
  );
};
