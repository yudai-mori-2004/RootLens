import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radii } from '../../theme';
import { t } from '../../i18n';

// 仕様書 §3.6: 情報を減らす操作 — サイズ変更（縮小のみ）
// アスペクト比は固定。解像度（ピクセル数）のみ均一に縮小する

interface ResizeToolProps {
  effectiveWidth: number;
  effectiveHeight: number;
  onApply: (size: { width: number; height: number }) => void;
  onCancel: () => void;
}

const SCALE_PRESETS = [
  { label: '75%', scale: 0.75 },
  { label: '50%', scale: 0.5 },
  { label: '25%', scale: 0.25 },
];

export default function ResizeTool({ effectiveWidth, effectiveHeight, onApply, onCancel }: ResizeToolProps) {
  const insets = useSafeAreaInsets();
  const [selectedScale, setSelectedScale] = useState<number | null>(null);

  const handleApply = () => {
    if (selectedScale == null) return;
    onApply({
      width: Math.round(effectiveWidth * selectedScale),
      height: Math.round(effectiveHeight * selectedScale),
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.cancelText}>{t('editTool.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleApply} disabled={selectedScale == null} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.applyText, selectedScale == null && styles.applyTextDisabled]}>{t('editTool.apply')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.currentSize}>
          {t('resize.currentSize', { width: effectiveWidth, height: effectiveHeight })}
        </Text>

        <View style={styles.presetList}>
          {SCALE_PRESETS.map((p) => {
            const w = Math.round(effectiveWidth * p.scale);
            const h = Math.round(effectiveHeight * p.scale);
            const isSelected = selectedScale === p.scale;
            return (
              <TouchableOpacity
                key={p.label}
                style={[styles.presetItem, isSelected && styles.presetItemActive]}
                onPress={() => setSelectedScale(isSelected ? null : p.scale)}
              >
                <Text style={[styles.presetLabel, isSelected && styles.presetLabelActive]}>
                  {p.label}
                </Text>
                <Text style={[styles.presetDimensions, isSelected && styles.presetDimensionsActive]}>
                  {w} x {h} px
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, height: 52,
  },
  cancelText: { color: colors.darkText, ...typography.body },
  applyText: { color: colors.darkText, ...typography.bodyMedium },
  applyTextDisabled: { color: colors.darkTextDisabled },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  currentSize: { color: colors.darkTextSecondary, ...typography.body, fontSize: 14, textAlign: 'center', marginBottom: spacing.xxl },
  presetList: { gap: spacing.md },
  presetItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.overlayWhiteFaint, borderRadius: radii.md,
    paddingVertical: spacing.lg, paddingHorizontal: 20,
  },
  presetItemActive: { backgroundColor: colors.darkText },
  presetLabel: { color: colors.darkText, ...typography.title },
  presetLabelActive: { color: colors.darkBg },
  presetDimensions: { color: colors.darkTextSecondary, ...typography.body, fontSize: 14 },
  presetDimensionsActive: { color: colors.overlayDark },
});
