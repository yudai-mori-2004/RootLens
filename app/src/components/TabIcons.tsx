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
  const fill = active ? colors.accentSoft : 'transparent';
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
      {active && <Circle cx={12} cy={13} r={1.4} fill={colors.accent} />}
    </Svg>
  );
};

export const CollectionIcon: React.FC<IconProps> = ({ active, size = 24 }) => {
  const stroke = active ? colors.ink : colors.textMute;
  const fill = active ? colors.accentSoft : 'transparent';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Stacked cards / film strip */}
      <Rect
        x={4} y={6} width={16} height={12} rx={2}
        stroke={stroke} strokeWidth={STROKE} fill={fill}
      />
      <Path d="M7 4h10" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      <Path d="M5 20h14" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      {active && <Circle cx={12} cy={12} r={1.6} fill={colors.accent} />}
    </Svg>
  );
};

// Home (= ライブラリ感のあるアーチ / 円弧)。 旧 Collection を踏まえつつ「ホーム」 らしい
// ニュアンスを足す。 ファインダー風のコーナーティック + アパチャ中央ドット。
export const HomeIcon: React.FC<IconProps> = ({ active, size = 24 }) => {
  const stroke = active ? colors.ink : colors.textMute;
  const accent = active ? colors.accent : colors.textMute;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Viewfinder ticks (= 4 corners) */}
      <Path d="M4 8.5V5h3.5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      <Path d="M16.5 5H20v3.5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      <Path d="M20 15.5V19h-3.5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      <Path d="M7.5 19H4v-3.5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
      {/* Aperture core */}
      <Circle cx={12} cy={12} r={3.4} stroke={stroke} strokeWidth={STROKE} fill={active ? colors.accentSoft : 'transparent'} />
      {active && <Circle cx={12} cy={12} r={1.2} fill={accent} />}
    </Svg>
  );
};

// Center Camera tab (= 撮影モード入口)。 タブバー上の他アイコンと違い、 リング型で
// 一段大きく扱う想定 (= MainTabs 側で size=32 + 余白)。 active 時は accent で塗る。
export const CameraIcon: React.FC<IconProps> = ({ active, size = 28 }) => {
  const ring = active ? colors.accent : colors.ink;
  const inner = active ? colors.paper : colors.accent;
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      {/* Outer ring */}
      <Circle cx={14} cy={14} r={11.5} stroke={ring} strokeWidth={1.8} fill={active ? colors.accent : 'transparent'} />
      {/* Aperture petal hint */}
      <Circle cx={14} cy={14} r={6.5} stroke={inner} strokeWidth={1.6} fill="transparent" />
      {/* Shutter dot */}
      <Circle cx={14} cy={14} r={2.2} fill={inner} />
    </Svg>
  );
};

export const SettingsIcon: React.FC<IconProps> = ({ active, size = 24 }) => {
  const stroke = active ? colors.ink : colors.textMute;
  const fill = active ? colors.accentSoft : 'transparent';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gear */}
      <Path
        d="M12 2.5l1.7 2.6 3.1-.5.5 3.1 2.6 1.7-1.4 2.8 1.4 2.8-2.6 1.7-.5 3.1-3.1-.5L12 21.5l-1.7-2.6-3.1.5-.5-3.1L4.1 14.6l1.4-2.8-1.4-2.8 2.6-1.7.5-3.1 3.1.5L12 2.5z"
        stroke={stroke} strokeWidth={STROKE} strokeLinejoin="round" fill={fill}
      />
      <Circle cx={12} cy={12} r={2.6} stroke={stroke} strokeWidth={STROKE} />
      {active && <Circle cx={12} cy={12} r={1.2} fill={colors.accent} />}
    </Svg>
  );
};
