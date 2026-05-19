import React from 'react';
import Svg, { Rect, Line, Circle } from 'react-native-svg';
import { colors } from '../theme';

// Phone outline icon that snaps to portrait or landscape silhouette.
// Used in TaskBriefing (briefing card) and CaptureScreen (mount-orientation gate).
//
// Line-only drawing matches TabIcons.tsx, the illustrative spine of the app.
// Strokes use ink at full weight; the speaker slit + camera dot read as a real
// phone without resorting to an emoji.

interface Props {
  orientation: 'portrait' | 'landscape';
  size?: number;          // longest edge of the bounding box, in px
  stroke?: string;
  accent?: string;
  strokeWidth?: number;
  // Optional motion indicator: a rotation arc + arrow that suggests "turn
  // your phone this way". Used in the mount-gate overlay where the user
  // needs to be told to rotate, not just shown the target state.
  withRotationHint?: boolean;
}

const ASPECT = 0.5;   // shorter / longer edge — slightly slimmer than iPhone, reads as a "phone"
const CORNER = 0.16;  // corner radius as fraction of shorter edge

export const PhoneOrientationIcon: React.FC<Props> = ({
  orientation,
  size = 96,
  stroke = colors.ink,
  accent = colors.emeraldDeep,
  strokeWidth = 1.8,
  withRotationHint = false,
}) => {
  const isLandscape = orientation === 'landscape';
  const long = size;
  const short = size * ASPECT;
  const w = isLandscape ? long : short;
  const h = isLandscape ? short : long;
  // Padding so we leave room for the optional rotation arc outside the body
  const pad = withRotationHint ? size * 0.18 : 2;
  const viewW = w + pad * 2;
  const viewH = h + pad * 2;
  const bodyX = pad;
  const bodyY = pad;
  const rx = short * CORNER;

  // Notch / speaker bar centered on the top short edge of the phone body
  const notchLen = short * 0.34;
  const notchThickness = strokeWidth * 1.2;
  // Camera dot, slightly offset
  const camR = strokeWidth * 0.9;
  // Anchors for top edge center
  const top = isLandscape
    ? { x: bodyX, y: bodyY + h / 2, dx: 0, dy: 1 }   // top edge is on the LEFT in landscape
    : { x: bodyX + w / 2, y: bodyY,    dx: 1, dy: 0 };

  // Notch line endpoints
  const notchX1 = top.x - (top.dx * notchLen) / 2;
  const notchY1 = top.y - (top.dy * notchLen) / 2;
  const notchX2 = top.x + (top.dx * notchLen) / 2;
  const notchY2 = top.y + (top.dy * notchLen) / 2;

  // Camera dot, ~30% from notch end toward inside
  const camOff = notchLen * 0.85;
  const camX = top.x + top.dx * camOff;
  const camY = top.y + top.dy * camOff;

  return (
    <Svg width={viewW} height={viewH} viewBox={`0 0 ${viewW} ${viewH}`} fill="none">
      {/* Optional rotation arc — quarter arc that swings the long edge */}
      {withRotationHint ? (
        <>
          {/* arc */}
          <Line
            x1={viewW / 2 - size * 0.45}
            y1={viewH / 2 + size * 0.55}
            x2={viewW / 2 + size * 0.45}
            y2={viewH / 2 + size * 0.55}
            stroke={accent}
            strokeWidth={strokeWidth * 0.8}
            strokeDasharray="2,3"
            strokeLinecap="round"
          />
        </>
      ) : null}

      {/* Phone body */}
      <Rect
        x={bodyX}
        y={bodyY}
        width={w}
        height={h}
        rx={rx}
        ry={rx}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={colors.card}
      />

      {/* Speaker / notch bar on the top edge (= the edge that is "up" in held orientation) */}
      <Line
        x1={notchX1}
        y1={notchY1}
        x2={notchX2}
        y2={notchY2}
        stroke={stroke}
        strokeWidth={notchThickness}
        strokeLinecap="round"
      />

      {/* Camera dot, accent color */}
      <Circle cx={camX} cy={camY} r={camR} fill={accent} />
    </Svg>
  );
};
