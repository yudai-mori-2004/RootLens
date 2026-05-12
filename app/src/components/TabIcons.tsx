import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { colors } from '../theme';

// Inline-SVG tab icons. Line-only when inactive; filled-stroke + dot indicator
// when focused. Sized to 24px on a 24-viewBox grid.
//
// Aesthetic note: the line weight (1.5px) and the use of subtle round caps
// matches the Week-5 illustration line work — the tab bar is the smallest
// touch-point with the brand and benefits from the same drawing language.

interface IconProps {
  active: boolean;
  size?: number;
}

const STROKE = 1.6;

export const JobIcon: React.FC<IconProps> = ({ active, size = 24 }) => {
  const stroke = active ? colors.ink : colors.textMute;
  const fill = active ? colors.emeraldSoft : 'transparent';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Briefcase */}
      <Rect
        x={3} y={7.5} width={18} height={12} rx={2}
        stroke={stroke} strokeWidth={STROKE} fill={fill}
      />
      <Path
        d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5"
        stroke={stroke} strokeWidth={STROKE} strokeLinecap="round"
      />
      <Path d="M3 12h18" stroke={stroke} strokeWidth={STROKE} />
      {active && <Circle cx={12} cy={13} r={1.4} fill={colors.emerald} />}
    </Svg>
  );
};

export const CollectionIcon: React.FC<IconProps> = ({ active, size = 24 }) => {
  const stroke = active ? colors.ink : colors.textMute;
  const fill = active ? colors.emeraldSoft : 'transparent';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Stacked cards / film strip */}
      <Rect
        x={4} y={6} width={16} height={12} rx={2}
        stroke={stroke} strokeWidth={STROKE} fill={fill}
      />
      <Path d="M7 4h10" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      <Path d="M5 20h14" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      {active && <Circle cx={12} cy={12} r={1.6} fill={colors.emerald} />}
    </Svg>
  );
};

export const SettingsIcon: React.FC<IconProps> = ({ active, size = 24 }) => {
  const stroke = active ? colors.ink : colors.textMute;
  const fill = active ? colors.emeraldSoft : 'transparent';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gear */}
      <Path
        d="M12 2.5l1.7 2.6 3.1-.5.5 3.1 2.6 1.7-1.4 2.8 1.4 2.8-2.6 1.7-.5 3.1-3.1-.5L12 21.5l-1.7-2.6-3.1.5-.5-3.1L4.1 14.6l1.4-2.8-1.4-2.8 2.6-1.7.5-3.1 3.1.5L12 2.5z"
        stroke={stroke} strokeWidth={STROKE} strokeLinejoin="round" fill={fill}
      />
      <Circle cx={12} cy={12} r={2.6} stroke={stroke} strokeWidth={STROKE} />
      {active && <Circle cx={12} cy={12} r={1.2} fill={colors.emerald} />}
    </Svg>
  );
};
