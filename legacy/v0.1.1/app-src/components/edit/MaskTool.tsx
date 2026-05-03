import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radii } from '../../theme';
import { t } from '../../i18n';

// 仕様書 §3.6: 情報を減らす操作 — 黒マスク（矩形）の付与
// マスクはViewオーバーレイとして描画（ピクセル加工は保存時のみ）
// 既存マスクの選択・移動・拡縮・回転に対応

interface MaskRect {
  id: number;
  cx: number; cy: number; // 中心座標（コンテナ相対）
  w: number; h: number;
  rotation: number; // degrees
}

interface MaskToolProps {
  imageUri: string;
  sourceRegion?: { x: number; y: number; w: number; h: number };
  existingMasks: Array<{ x: number; y: number; w: number; h: number; rotation: number }>;
  onApply: (masks: Array<{ x: number; y: number; w: number; h: number; rotation: number }>, replaceAll: boolean) => void;
  onCancel: () => void;
}

const HANDLE_HIT = 36;
const MIN_MASK_SIZE = 20;
const ROTATION_HANDLE_DIST = 35;

type Interaction = 'idle' | 'drawing' | 'moving' | 'resizing' | 'rotating';
type Corner = 'tl' | 'tr' | 'bl' | 'br';

export default function MaskTool({ imageUri, sourceRegion, existingMasks, onApply, onCancel }: MaskToolProps) {
  const insets = useSafeAreaInsets();
  const [fullImageSize, setFullImageSize] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);

  const [masks, setMasks] = useState<MaskRect[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const nextId = useRef(0);

  // 既存マスクの初期位置（変更検出用）
  const originalMaskPositions = useRef<MaskRect[]>([]);

  useEffect(() => {
    Image.getSize(imageUri, (w, h) => setFullImageSize({ w, h }));
  }, [imageUri]);

  useEffect(() => {
    if (!fullImageSize || !containerSize) return;
    const region = sourceRegion ?? { x: 0, y: 0, w: fullImageSize.w, h: fullImageSize.h };

    const scale = Math.min(containerSize.w / region.w, containerSize.h / region.h);
    const dw = region.w * scale;
    const dh = region.h * scale;
    const ox = (containerSize.w - dw) / 2;
    const oy = (containerSize.h - dh) / 2;
    setDisplaySize({ w: dw, h: dh });
    setImageOffset({ x: ox, y: oy });

    // 既存マスクをeffectiveSize座標 → 表示座標に変換
    const converted: MaskRect[] = existingMasks.map((m, i) => ({
      id: i,
      cx: ox + (m.x + m.w / 2) * (dw / region.w),
      cy: oy + (m.y + m.h / 2) * (dh / region.h),
      w: m.w * (dw / region.w),
      h: m.h * (dh / region.h),
      rotation: m.rotation,
    }));
    setMasks(converted);
    originalMaskPositions.current = converted.map(m => ({ ...m }));
    nextId.current = existingMasks.length;
    setReady(true);
  }, [fullImageSize, containerSize, sourceRegion, existingMasks]);

  const onContainerLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ w: width, h: height });
  }, []);

  // --- Hit testing ---
  const masksRef = useRef(masks);
  masksRef.current = masks;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const isPointInMask = (px: number, py: number, m: MaskRect): boolean => {
    const rad = -m.rotation * Math.PI / 180;
    const dx = px - m.cx;
    const dy = py - m.cy;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(rx) <= m.w / 2 && Math.abs(ry) <= m.h / 2;
  };

  const findMaskAt = (px: number, py: number): MaskRect | null => {
    for (let i = masksRef.current.length - 1; i >= 0; i--) {
      if (isPointInMask(px, py, masksRef.current[i])) return masksRef.current[i];
    }
    return null;
  };

  const getCornerAt = (px: number, py: number, m: MaskRect): Corner | null => {
    const rad = m.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const hw = m.w / 2, hh = m.h / 2;
    const corners: { key: Corner; lx: number; ly: number }[] = [
      { key: 'tl', lx: -hw, ly: -hh },
      { key: 'tr', lx: hw, ly: -hh },
      { key: 'bl', lx: -hw, ly: hh },
      { key: 'br', lx: hw, ly: hh },
    ];
    for (const c of corners) {
      const sx = m.cx + c.lx * cos - c.ly * sin;
      const sy = m.cy + c.lx * sin + c.ly * cos;
      if (Math.abs(px - sx) < HANDLE_HIT && Math.abs(py - sy) < HANDLE_HIT) return c.key;
    }
    return null;
  };

  // 回転ハンドル位置計算
  const getRotHandleInfo = (m: MaskRect) => {
    const rad = m.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const topX = m.cx + 0 * cos - (-m.h / 2) * sin;
    const topY = m.cy + 0 * sin + (-m.h / 2) * cos;
    const hx = topX + sin * ROTATION_HANDLE_DIST;
    const hy = topY - cos * ROTATION_HANDLE_DIST;
    return { topX, topY, hx, hy };
  };

  const isOnRotationHandle = (px: number, py: number, m: MaskRect): boolean => {
    const { hx, hy } = getRotHandleInfo(m);
    return Math.abs(px - hx) < HANDLE_HIT && Math.abs(py - hy) < HANDLE_HIT;
  };

  // --- PanResponder ---
  const interactionRef = useRef<Interaction>('idle');
  const activeCornerRef = useRef<Corner | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, mask: null as MaskRect | null });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX: px, locationY: py } = evt.nativeEvent;

        const sel = selectedIdRef.current;
        const selMask = sel !== null ? masksRef.current.find(m => m.id === sel) : null;

        if (selMask) {
          if (isOnRotationHandle(px, py, selMask)) {
            interactionRef.current = 'rotating';
            dragStartRef.current = { x: px, y: py, mask: { ...selMask } };
            return;
          }
          const corner = getCornerAt(px, py, selMask);
          if (corner) {
            interactionRef.current = 'resizing';
            activeCornerRef.current = corner;
            dragStartRef.current = { x: px, y: py, mask: { ...selMask } };
            return;
          }
          if (isPointInMask(px, py, selMask)) {
            interactionRef.current = 'moving';
            dragStartRef.current = { x: px, y: py, mask: { ...selMask } };
            return;
          }
        }

        const hit = findMaskAt(px, py);
        if (hit) {
          setSelectedId(hit.id);
          selectedIdRef.current = hit.id;
          interactionRef.current = 'moving';
          dragStartRef.current = { x: px, y: py, mask: { ...hit } };
          return;
        }

        setSelectedId(null);
        selectedIdRef.current = null;
        interactionRef.current = 'drawing';
        const id = nextId.current++;
        const newMask: MaskRect = { id, cx: px, cy: py, w: 0, h: 0, rotation: 0 };
        dragStartRef.current = { x: px, y: py, mask: newMask };
        setMasks(prev => [...prev, newMask]);
      },

      onPanResponderMove: (_, gesture) => {
        const { dx, dy } = gesture;
        const start = dragStartRef.current;
        if (!start.mask) return;

        switch (interactionRef.current) {
          case 'drawing': {
            const cx = start.x + dx / 2;
            const cy = start.y + dy / 2;
            setMasks(prev => prev.map(m =>
              m.id === start.mask!.id ? { ...m, cx, cy, w: Math.abs(dx), h: Math.abs(dy) } : m
            ));
            break;
          }
          case 'moving': {
            setMasks(prev => prev.map(m =>
              m.id === start.mask!.id
                ? { ...m, cx: start.mask!.cx + dx, cy: start.mask!.cy + dy }
                : m
            ));
            break;
          }
          case 'resizing': {
            const m = start.mask!;
            const rad = m.rotation * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const hw = m.w / 2, hh = m.h / 2;
            const opp: Record<Corner, { lx: number; ly: number }> = {
              tl: { lx: hw, ly: hh }, tr: { lx: -hw, ly: hh },
              bl: { lx: hw, ly: -hh }, br: { lx: -hw, ly: -hh },
            };
            const corner = activeCornerRef.current!;
            const fix = opp[corner];
            const fixX = m.cx + fix.lx * cos - fix.ly * sin;
            const fixY = m.cy + fix.lx * sin + fix.ly * cos;
            const drag = { tl: { lx: -hw, ly: -hh }, tr: { lx: hw, ly: -hh }, bl: { lx: -hw, ly: hh }, br: { lx: hw, ly: hh } }[corner];
            const origX = m.cx + drag.lx * cos - drag.ly * sin;
            const origY = m.cy + drag.lx * sin + drag.ly * cos;
            const vx = (origX + dx) - fixX;
            const vy = (origY + dy) - fixY;
            const newW = Math.max(MIN_MASK_SIZE, Math.abs(vx * cos + vy * sin));
            const newH = Math.max(MIN_MASK_SIZE, Math.abs(-vx * sin + vy * cos));
            setMasks(prev => prev.map(mk =>
              mk.id === m.id ? { ...mk, cx: (fixX + origX + dx) / 2, cy: (fixY + origY + dy) / 2, w: newW, h: newH } : mk
            ));
            break;
          }
          case 'rotating': {
            const m = start.mask!;
            const angle = Math.atan2(
              start.x + dx - m.cx,
              -(start.y + dy - m.cy),
            ) * 180 / Math.PI;
            setMasks(prev => prev.map(mk =>
              mk.id === m.id ? { ...mk, rotation: angle } : mk
            ));
            break;
          }
        }
      },

      onPanResponderRelease: () => {
        if (interactionRef.current === 'drawing') {
          setMasks(prev => prev.filter(m => m.w > MIN_MASK_SIZE && m.h > MIN_MASK_SIZE));
        }
        interactionRef.current = 'idle';
      },
    })
  ).current;

  const removeLast = () => {
    setMasks(prev => {
      if (prev.length === 0) return prev;
      const removed = prev[prev.length - 1];
      if (selectedId === removed.id) setSelectedId(null);
      return prev.slice(0, -1);
    });
  };

  // 既存マスクが変更されたか検出
  const isExistingModified = masks.some((m, i) => {
    if (i >= existingMasks.length) return false;
    const orig = originalMaskPositions.current[i];
    if (!orig) return false;
    return m.cx !== orig.cx || m.cy !== orig.cy || m.w !== orig.w || m.h !== orig.h || m.rotation !== orig.rotation;
  });

  const handleApply = () => {
    if (!displaySize.w) return;
    const region = sourceRegion ?? (fullImageSize ? { x: 0, y: 0, w: fullImageSize.w, h: fullImageSize.h } : null);
    if (!region) return;

    const scaleX = region.w / displaySize.w;
    const scaleY = region.h / displaySize.h;
    const toCanvas = (m: MaskRect) => ({
      x: (m.cx - m.w / 2 - imageOffset.x) * scaleX,
      y: (m.cy - m.h / 2 - imageOffset.y) * scaleY,
      w: m.w * scaleX,
      h: m.h * scaleY,
      rotation: m.rotation,
    });

    if (isExistingModified) {
      onApply(masks.map(toCanvas), true);
    } else {
      onApply(masks.slice(existingMasks.length).map(toCanvas), false);
    }
  };

  const renderImage = () => {
    if (!fullImageSize || !ready) return null;
    const region = sourceRegion ?? { x: 0, y: 0, w: fullImageSize.w, h: fullImageSize.h };
    const imgScale = displaySize.w / region.w;
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image
          source={{ uri: imageUri }}
          style={{
            position: 'absolute',
            width: fullImageSize.w * imgScale,
            height: fullImageSize.h * imgScale,
            left: imageOffset.x - region.x * imgScale,
            top: imageOffset.y - region.y * imgScale,
          }}
        />
      </View>
    );
  };

  const selectedMask = masks.find(m => m.id === selectedId);
  const newMaskCount = masks.length - existingMasks.length;
  const canApply = newMaskCount > 0 || isExistingModified;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.cancelText}>{t('editTool.cancel')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerHint}>{t('mask.hint')}</Text>
        <TouchableOpacity
          onPress={handleApply}
          disabled={!canApply}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.applyText, !canApply && styles.applyTextDisabled]}>
            {t('editTool.apply')}{newMaskCount > 0 ? `(${newMaskCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={styles.maskArea}
        onLayout={onContainerLayout}
        {...panResponder.panHandlers}
      >
        {renderImage()}

        {masks.map(m => (
          <View
            key={m.id}
            style={[
              styles.maskRect,
              {
                left: m.cx - m.w / 2,
                top: m.cy - m.h / 2,
                width: m.w,
                height: m.h,
                transform: [{ rotate: `${m.rotation}deg` }],
              },
              m.id < existingMasks.length && styles.maskRectExisting,
              m.id === selectedId && styles.maskRectSelected,
            ]}
            pointerEvents="none"
          />
        ))}

        {/* 選択中マスクの回転ハンドル */}
        {selectedMask && selectedMask.w > MIN_MASK_SIZE && (() => {
          const { topX, topY, hx, hy } = getRotHandleInfo(selectedMask);
          return (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {/* 接続線: topCenter → handle */}
              <View style={{
                position: 'absolute',
                left: (topX + hx) / 2 - 0.5,
                top: (topY + hy) / 2 - ROTATION_HANDLE_DIST / 2,
                width: 1,
                height: ROTATION_HANDLE_DIST,
                backgroundColor: colors.overlayWhiteLine,
                transform: [{ rotate: `${selectedMask.rotation}deg` }],
              }} />
              {/* 回転ハンドル */}
              <View style={[styles.rotationHandle, { left: hx - 12, top: hy - 12 }]}>
                <Ionicons name="refresh-outline" size={16} color={colors.darkText} />
              </View>
            </View>
          );
        })()}
      </View>

      <View style={styles.bottomBar}>
        {masks.length > 0 ? (
          <TouchableOpacity style={styles.undoBtn} onPress={removeLast}>
            <Ionicons name="arrow-undo" size={18} color={colors.darkText} />
            <Text style={styles.undoBtnText}>{t('mask.undo')}</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, height: 52 },
  cancelText: { color: colors.darkText, ...typography.body },
  headerHint: { color: colors.darkTextSecondary, ...typography.caption },
  applyText: { color: colors.darkText, ...typography.bodyMedium },
  applyTextDisabled: { color: colors.darkTextDisabled },
  maskArea: { flex: 1, overflow: 'hidden' },
  maskRect: { position: 'absolute', backgroundColor: colors.darkBg, borderWidth: 1, borderColor: colors.darkSeparator },
  maskRectExisting: { opacity: 0.7 },
  maskRectSelected: { borderColor: colors.darkText, borderWidth: 2 },
  rotationHandle: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: colors.overlayWhiteMask, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: 52 },
  undoBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 18, backgroundColor: colors.overlayWhiteSubtle },
  undoBtnText: { color: colors.darkText, ...typography.body, fontSize: 14 },
});
