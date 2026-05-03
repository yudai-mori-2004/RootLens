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
import { Video, ResizeMode } from 'expo-av';
import { colors, typography, spacing, radii } from '../../theme';
import { t } from '../../i18n';

// 仕様書 §3.6: 情報を減らす操作 — クロップ
// sourceRegionで渡された範囲のみ表示し、その中でクロップ操作を行う
// 出力座標はsourceRegion内の相対座標（現在のcanvas空間基準）

const MIN_CROP_SIZE = 60;
const HANDLE_HIT = 44;
const CORNER_LEN = 22;
const CORNER_W = 3;

interface CropToolProps {
  imageUri: string;
  mediaType?: 'image' | 'video';
  /** 元画像から表示する領域 (ピクセル座標)。undefinedなら全体 */
  sourceRegion?: { x: number; y: number; w: number; h: number };
  onApply: (crop: { originX: number; originY: number; width: number; height: number }) => void;
  onCancel: () => void;
}

type AspectRatio = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

const ASPECT_RATIOS: { label: string; value: AspectRatio; ratio?: number }[] = [
  { label: 'crop.free', value: 'free' },
  { label: '1:1', value: '1:1', ratio: 1 },
  { label: '4:3', value: '4:3', ratio: 4 / 3 },
  { label: '3:4', value: '3:4', ratio: 3 / 4 },
  { label: '16:9', value: '16:9', ratio: 16 / 9 },
  { label: '9:16', value: '9:16', ratio: 9 / 16 },
];

export default function CropTool({ imageUri, mediaType = 'image', sourceRegion, onApply, onCancel }: CropToolProps) {
  const isVideo = mediaType === 'video';
  const insets = useSafeAreaInsets();
  const [fullImageSize, setFullImageSize] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('free');
  const [ready, setReady] = useState(false);

  // 表示用の計算結果
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });

  // sourceRegionまたは画像全体
  const sr = sourceRegion;

  // Refs for PanResponder
  const cropRef = useRef(cropRect);
  cropRef.current = cropRect;
  const aspectRatioRef = useRef(aspectRatio);
  aspectRatioRef.current = aspectRatio;
  const displaySizeRef = useRef(displaySize);
  displaySizeRef.current = displaySize;
  const imageOffsetRef = useRef(imageOffset);
  imageOffsetRef.current = imageOffset;

  useEffect(() => {
    if (!isVideo) {
      Image.getSize(imageUri, (w, h) => {
        setFullImageSize({ w, h });
      });
    }
  }, [imageUri, isVideo]);

  useEffect(() => {
    if (!fullImageSize || !containerSize) return;
    const region = sr ?? { x: 0, y: 0, w: fullImageSize.w, h: fullImageSize.h };

    // コンテナ内にsourceRegionをフィット表示
    const scale = Math.min(containerSize.w / region.w, containerSize.h / region.h);
    const dw = region.w * scale;
    const dh = region.h * scale;
    const ox = (containerSize.w - dw) / 2;
    const oy = (containerSize.h - dh) / 2;

    setDisplaySize({ w: dw, h: dh });
    setImageOffset({ x: ox, y: oy });
    setCropRect({ x: ox, y: oy, w: dw, h: dh });
    setReady(true);
  }, [fullImageSize, containerSize, sr]);

  const onContainerLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ w: width, h: height });
  }, []);

  const clampRect = useCallback((r: typeof cropRect) => {
    const io = imageOffsetRef.current;
    const ds = displaySizeRef.current;
    let { x, y, w, h } = r;
    w = Math.max(MIN_CROP_SIZE, w);
    h = Math.max(MIN_CROP_SIZE, h);
    x = Math.max(io.x, Math.min(x, io.x + ds.w - w));
    y = Math.max(io.y, Math.min(y, io.y + ds.h - h));
    if (x + w > io.x + ds.w) w = io.x + ds.w - x;
    if (y + h > io.y + ds.h) h = io.y + ds.h - y;
    return { x, y, w, h };
  }, []);

  const handleAspectChange = useCallback((ar: AspectRatio) => {
    setAspectRatio(ar);
    const ratioInfo = ASPECT_RATIOS.find(a => a.value === ar);
    if (ratioInfo?.ratio && displaySizeRef.current.w > 0) {
      const r = cropRef.current;
      const ratio = ratioInfo.ratio;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      let w = r.w;
      let h = w / ratio;
      const ds = displaySizeRef.current;
      if (h > ds.h) { h = ds.h; w = h * ratio; }
      if (w > ds.w) { w = ds.w; h = w / ratio; }
      setCropRect(clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }));
    }
  }, [clampRect]);

  type DragMode = 'move' | 'tl' | 'tr' | 'bl' | 'br';
  const dragMode = useRef<DragMode>('move');
  const dragStart = useRef({ x: 0, y: 0, rect: { x: 0, y: 0, w: 0, h: 0 } });

  const getDragMode = (x: number, y: number): DragMode => {
    const r = cropRef.current;
    if (Math.abs(x - r.x) < HANDLE_HIT && Math.abs(y - r.y) < HANDLE_HIT) return 'tl';
    if (Math.abs(x - (r.x + r.w)) < HANDLE_HIT && Math.abs(y - r.y) < HANDLE_HIT) return 'tr';
    if (Math.abs(x - r.x) < HANDLE_HIT && Math.abs(y - (r.y + r.h)) < HANDLE_HIT) return 'bl';
    if (Math.abs(x - (r.x + r.w)) < HANDLE_HIT && Math.abs(y - (r.y + r.h)) < HANDLE_HIT) return 'br';
    return 'move';
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        dragMode.current = getDragMode(locationX, locationY);
        dragStart.current = { x: locationX, y: locationY, rect: { ...cropRef.current } };
      },
      onPanResponderMove: (_, gesture) => {
        const { dx, dy } = gesture;
        const start = dragStart.current.rect;
        const ratioInfo = ASPECT_RATIOS.find(a => a.value === aspectRatioRef.current);
        const ratio = ratioInfo?.ratio;
        let newRect: typeof cropRect;

        switch (dragMode.current) {
          case 'move':
            newRect = { ...start, x: start.x + dx, y: start.y + dy };
            break;
          case 'tl': {
            let nw = start.w - dx, nh = start.h - dy;
            if (ratio) nh = nw / ratio;
            newRect = { x: start.x + start.w - nw, y: start.y + start.h - nh, w: nw, h: nh };
            break;
          }
          case 'tr': {
            let nw = start.w + dx, nh = start.h - dy;
            if (ratio) nh = nw / ratio;
            newRect = { x: start.x, y: start.y + start.h - nh, w: nw, h: nh };
            break;
          }
          case 'bl': {
            let nw = start.w - dx, nh = start.h + dy;
            if (ratio) nh = nw / ratio;
            newRect = { x: start.x + start.w - nw, y: start.y, w: nw, h: nh };
            break;
          }
          case 'br': {
            let nw = start.w + dx, nh = start.h + dy;
            if (ratio) nh = nw / ratio;
            newRect = { x: start.x, y: start.y, w: nw, h: nh };
            break;
          }
          default:
            newRect = start;
        }
        setCropRect(clampRect(newRect));
      },
    })
  ).current;

  const handleApply = () => {
    if (!displaySize.w) return;
    const region = sr
      ? { w: sr.w, h: sr.h }
      : fullImageSize
        ? { w: fullImageSize.w, h: fullImageSize.h }
        : null;
    if (!region) return;

    // 表示座標 → sourceRegion内ピクセル座標
    const scale = region.w / displaySize.w;
    onApply({
      originX: Math.round((cropRect.x - imageOffset.x) * scale),
      originY: Math.round((cropRect.y - imageOffset.y) * scale),
      width: Math.round(cropRect.w * scale),
      height: Math.round(cropRect.h * scale),
    });
  };

  const c = cropRect;

  // 動画の場合、Videoコンポーネントからサイズを取得
  const onVideoReady = useCallback((event: { naturalSize: { width: number; height: number } }) => {
    const { width: w, height: h } = event.naturalSize;
    if (w > 0 && h > 0 && !fullImageSize) {
      setFullImageSize({ w, h });
    }
  }, [fullImageSize]);

  // sourceRegionがある場合、元メディアのその部分だけ表示する
  const renderMedia = () => {
    if (!fullImageSize || !containerSize || !ready) {
      // 動画の場合、サイズ取得のためにVideoを先にレンダリング
      if (isVideo) {
        return (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Video
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFill}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={false}
              onReadyForDisplay={onVideoReady}
            />
          </View>
        );
      }
      return null;
    }
    const region = sr ?? { x: 0, y: 0, w: fullImageSize.w, h: fullImageSize.h };

    const imgScale = displaySize.w / region.w;
    const fullW = fullImageSize.w * imgScale;
    const fullH = fullImageSize.h * imgScale;
    const imgLeft = imageOffset.x - region.x * imgScale;
    const imgTop = imageOffset.y - region.y * imgScale;

    if (isVideo) {
      return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Video
            source={{ uri: imageUri }}
            style={{
              position: 'absolute',
              width: fullW,
              height: fullH,
              left: imgLeft,
              top: imgTop,
            }}
            resizeMode={ResizeMode.STRETCH}
            shouldPlay={false}
          />
        </View>
      );
    }

    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image
          source={{ uri: imageUri }}
          style={{
            position: 'absolute',
            width: fullW,
            height: fullH,
            left: imgLeft,
            top: imgTop,
          }}
        />
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.cancelText}>{t('editTool.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleApply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.applyText}>{t('editTool.apply')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cropArea} onLayout={onContainerLayout} {...panResponder.panHandlers}>
        {renderMedia()}

        {ready && (
          <>
            {/* ダークオーバーレイ */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={[styles.overlay, { top: 0, left: 0, right: 0, height: c.y }]} />
              <View style={[styles.overlay, { top: c.y + c.h, left: 0, right: 0, bottom: 0 }]} />
              <View style={[styles.overlay, { top: c.y, left: 0, width: c.x, height: c.h }]} />
              <View style={[styles.overlay, { top: c.y, left: c.x + c.w, right: 0, height: c.h }]} />
            </View>

            {/* クロップ枠 + グリッド */}
            <View
              style={[styles.cropFrame, { left: c.x, top: c.y, width: c.w, height: c.h }]}
              pointerEvents="none"
            >
              <View style={[styles.gridH, { top: '33.3%' }]} />
              <View style={[styles.gridH, { top: '66.6%' }]} />
              <View style={[styles.gridV, { left: '33.3%' }]} />
              <View style={[styles.gridV, { left: '66.6%' }]} />
            </View>

            {/* L字コーナーハンドル */}
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={[styles.cornerBar, { left: c.x - 1, top: c.y - 1, width: CORNER_LEN, height: CORNER_W }]} />
              <View style={[styles.cornerBar, { left: c.x - 1, top: c.y - 1, width: CORNER_W, height: CORNER_LEN }]} />
              <View style={[styles.cornerBar, { left: c.x + c.w - CORNER_LEN + 1, top: c.y - 1, width: CORNER_LEN, height: CORNER_W }]} />
              <View style={[styles.cornerBar, { left: c.x + c.w - CORNER_W + 1, top: c.y - 1, width: CORNER_W, height: CORNER_LEN }]} />
              <View style={[styles.cornerBar, { left: c.x - 1, top: c.y + c.h - CORNER_W + 1, width: CORNER_LEN, height: CORNER_W }]} />
              <View style={[styles.cornerBar, { left: c.x - 1, top: c.y + c.h - CORNER_LEN + 1, width: CORNER_W, height: CORNER_LEN }]} />
              <View style={[styles.cornerBar, { left: c.x + c.w - CORNER_LEN + 1, top: c.y + c.h - CORNER_W + 1, width: CORNER_LEN, height: CORNER_W }]} />
              <View style={[styles.cornerBar, { left: c.x + c.w - CORNER_W + 1, top: c.y + c.h - CORNER_LEN + 1, width: CORNER_W, height: CORNER_LEN }]} />
            </View>
          </>
        )}
      </View>

      <View style={styles.aspectRow}>
        {ASPECT_RATIOS.map((ar) => (
          <TouchableOpacity
            key={ar.value}
            style={[styles.aspectBtn, aspectRatio === ar.value && styles.aspectBtnActive]}
            onPress={() => handleAspectChange(ar.value)}
          >
            <Text style={[styles.aspectText, aspectRatio === ar.value && styles.aspectTextActive]}>
              {ar.value === 'free' ? t(ar.label) : ar.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, height: 52 },
  cancelText: { color: colors.darkText, ...typography.body },
  applyText: { color: colors.darkText, ...typography.bodyMedium },
  cropArea: { flex: 1, overflow: 'hidden' },
  overlay: { position: 'absolute', backgroundColor: colors.overlayCrop },
  cropFrame: { position: 'absolute', borderWidth: 1, borderColor: colors.overlayWhiteFrame },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.overlayWhiteGrid },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.overlayWhiteGrid },
  cornerBar: { position: 'absolute', backgroundColor: colors.darkText },
  aspectRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  aspectBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 14, backgroundColor: colors.overlayWhiteSubtle },
  aspectBtnActive: { backgroundColor: colors.darkText },
  aspectText: { color: colors.darkTextSecondary, ...typography.captionMedium },
  aspectTextActive: { color: colors.darkBg },
});
