import React, { useState, useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import {
  Canvas,
  useCanvasRef,
  Image as SkiaImage,
  useImage,
  RoundedRect,
  Text as SkiaText,
  Circle,
  Rect,
  Group,
  Path,
  Skia,
  ImageFormat,
  matchFont,
} from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system';
import QRCodeGenerator from 'qrcode';

// 仕様書 §7.3.1 ウォーターマークバッジ — 宣言的 Canvas + makeImageSnapshot

const BADGE_BG = '#0f1a3c';
const BADGE_RADIUS = 10;
const BADGE_MARGIN = 12;
const BADGE_PAD_V = 8;
const BADGE_PAD_L = 8;
const BADGE_PAD_R = 12;
const BASE_CHECK_SIZE = 24;
const BASE_QR_SIZE = 40;
const GAP = 8;
const EXPORT_TIMEOUT_MS = 15_000;
const SNAPSHOT_DELAY_MS = 300;

const FONT_FAMILY = Platform.OS === 'ios' ? 'Helvetica' : 'sans-serif';

export interface ExportRequest {
  sourceUrl: string;
  width: number;
  height: number;
  cropRegion?: { x: number; y: number; w: number; h: number };
  badge: {
    icon: 'qr' | 'check';
    qrValue?: string;
    username?: string;
    badgeScale?: number;
  } | null;
}

export interface ImageExportHandle {
  doExport: (req: ExportRequest) => Promise<string>;
}

const ImageExportCanvas = forwardRef<ImageExportHandle>((_, ref) => {
  const canvasRef = useCanvasRef();
  const [request, setRequest] = useState<ExportRequest | null>(null);
  // 各リクエストに一意 ID を付与し、同じ URL でも effect が確実に再発火するようにする
  const [requestId, setRequestId] = useState(0);
  const callbacksRef = useRef<{
    resolve: (path: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    doExport: (req: ExportRequest) =>
      new Promise<string>((resolve, reject) => {
        if (callbacksRef.current) {
          callbacksRef.current.reject(new Error('Export superseded'));
        }
        callbacksRef.current = { resolve, reject };
        setRequest(req);
        setRequestId((id) => id + 1);
      }),
  }), []);

  const sourceImage = useImage(request?.sourceUrl ?? undefined);

  // 画像ロード完了 → スナップショット（requestId で確実に再発火）
  useEffect(() => {
    if (!request || !sourceImage || !callbacksRef.current) return;

    const timer = setTimeout(async () => {
      const cbs = callbacksRef.current;
      if (!cbs) return;
      try {
        const snapshot = canvasRef.current?.makeImageSnapshot();
        if (!snapshot) throw new Error('Snapshot returned null');
        const base64 = snapshot.encodeToBase64(ImageFormat.JPEG, 90);
        const filePath = `${FileSystem.cacheDirectory}share_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(filePath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        cbs.resolve(filePath);
      } catch (e) {
        cbs.reject(e as Error);
      } finally {
        callbacksRef.current = null;
      }
    }, SNAPSHOT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [requestId, sourceImage]);

  // タイムアウト
  useEffect(() => {
    if (!request) return;
    const timeout = setTimeout(() => {
      const cbs = callbacksRef.current;
      if (cbs) {
        cbs.reject(new Error('Export timed out'));
        callbacksRef.current = null;
      }
    }, EXPORT_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [requestId]);

  // Canvas を常にマウント。リクエストがないときは 1x1、あるときは出力サイズ
  const ready = !!request && !!sourceImage;
  const w = ready ? request.width : 1;
  const h = ready ? request.height : 1;

  return (
    <View style={styles.hidden} pointerEvents="none" collapsable={false}>
      <Canvas style={{ width: w, height: h }} ref={canvasRef}>
        {ready && (
          <ExportContent
            request={request}
            sourceImage={sourceImage}
          />
        )}
      </Canvas>
    </View>
  );
});

export default ImageExportCanvas;

// ── Canvas 内容（画像+バッジ） ──

function ExportContent({ request, sourceImage }: {
  request: ExportRequest;
  sourceImage: NonNullable<ReturnType<typeof useImage>>;
}) {
  const { width, height, badge, cropRegion } = request;
  const srcW = sourceImage.width();
  const srcH = sourceImage.height();
  const crop = computeSrcRect(srcW, srcH, width, height, cropRegion);

  // crop 領域を出力サイズにマッピング
  // scaleX = scaleY であるべき（正規化クロップ座標からの変換なので一致するはず）
  const scaleX = width / crop.width;
  const scaleY = height / crop.height;
  const clipRect = Skia.XYWHRect(0, 0, width, height);

  // 画像を (crop.x, crop.y) 分ずらして、crop.width → width にスケール
  // SkiaImage の fit="fill" は x,y,width,height の矩形に画像をフィルする
  // → 元画像全体を scaleX 倍した座標系で描画し、クリップで出力範囲に切り取る
  return (
    <>
      <Group clip={clipRect}>
        <SkiaImage
          image={sourceImage}
          x={-crop.x * scaleX}
          y={-crop.y * scaleY}
          width={srcW * scaleX}
          height={srcH * scaleY}
          fit="cover"
        />
      </Group>
      {badge && <BadgeOverlay width={width} height={height} badge={badge} />}
    </>
  );
}

// ── ユーティリティ ──

function computeSrcRect(
  srcW: number, srcH: number, outW: number, outH: number,
  cropRegion?: ExportRequest['cropRegion'],
) {
  if (cropRegion) {
    return {
      x: Math.round(cropRegion.x * srcW),
      y: Math.round(cropRegion.y * srcH),
      width: Math.round(cropRegion.w * srcW),
      height: Math.round(cropRegion.h * srcH),
    };
  }
  const targetAspect = outW / outH;
  const srcAspect = srcW / srcH;
  if (srcAspect > targetAspect) {
    const w = Math.round(srcH * targetAspect);
    return { x: Math.round((srcW - w) / 2), y: 0, width: w, height: srcH };
  }
  const hh = Math.round(srcW / targetAspect);
  return { x: 0, y: Math.round((srcH - hh) / 2), width: srcW, height: hh };
}

// ── バッジ ──

// プレビューバッジの margin=12px を出力サイズに比例させる
// プレビューの基準幅を 350px と想定
const PREVIEW_REF_WIDTH = 350;

function BadgeOverlay({ width, height, badge }: {
  width: number; height: number;
  badge: NonNullable<ExportRequest['badge']>;
}) {
  const outputScale = width / PREVIEW_REF_WIDTH;
  const s = (badge.badgeScale ?? 1) * outputScale;
  const isQr = badge.icon === 'qr';
  const iconSize = (isQr ? BASE_QR_SIZE : BASE_CHECK_SIZE) * s;
  const fontSize = 14 * s;
  const usernameFontSize = 10 * s;

  const realFont = useMemo(() => matchFont({
    fontFamily: FONT_FAMILY, fontSize, fontWeight: '500', fontStyle: 'normal',
  }), [fontSize]);
  const usernameFont = useMemo(() => matchFont({
    fontFamily: FONT_FAMILY, fontSize: usernameFontSize, fontWeight: 'normal', fontStyle: 'normal',
  }), [usernameFontSize]);

  const padL = BADGE_PAD_L * s, padR = BADGE_PAD_R * s, padV = BADGE_PAD_V * s;
  const gap = GAP * s, margin = BADGE_MARGIN * s, radius = BADGE_RADIUS * s;

  const realText = 'Real';
  const realWidth = realFont.measureText(realText).width;
  const hasUsername = !!badge.username;
  const usernameText = hasUsername ? badge.username!.replace(/^@/, '') : 'username';
  const usernameWidth = usernameFont.measureText(usernameText).width;

  const textBlockW = Math.max(realWidth, usernameWidth);
  const badgeW = padL + iconSize + gap + textBlockW + padR;
  const badgeH = padV + Math.max(iconSize, 28 * s) + padV;
  const badgeX = width - badgeW - margin;
  const badgeY = height - badgeH - margin;
  const iconX = badgeX + padL;
  const iconY = badgeY + (badgeH - iconSize) / 2;
  const textX = iconX + iconSize + gap;
  const realY = usernameText
    ? badgeY + badgeH / 2 - 2 * s
    : badgeY + badgeH / 2 + fontSize * 0.35;

  return (
    <Group>
      <RoundedRect x={badgeX} y={badgeY} width={badgeW} height={badgeH} r={radius} color={BADGE_BG} />
      <RoundedRect x={badgeX} y={badgeY} width={badgeW} height={badgeH} r={radius}
        color="rgba(255,255,255,0.15)" style="stroke" strokeWidth={1.5 * s} />
      {isQr ? (
        <QRIcon x={iconX} y={iconY} size={iconSize} value={badge.qrValue || 'https://rootlens.io'} />
      ) : (
        <CheckIcon x={iconX} y={iconY} size={iconSize} />
      )}
      <SkiaText text={realText} x={textX} y={realY} color="#FFFFFF" font={realFont} />
      <SkiaText text={usernameText} x={textX} y={realY + fontSize}
        color={hasUsername ? '#878d9e' : '#4b536d'} font={usernameFont} />
    </Group>
  );
}

function CheckIcon({ x, y, size }: { x: number; y: number; size: number }) {
  const cx = x + size / 2, cy = y + size / 2, sc = size / BASE_CHECK_SIZE;
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(cx - 5 * sc, cy);
    p.lineTo(cx - 1 * sc, cy + 4 * sc);
    p.lineTo(cx + 6 * sc, cy - 4 * sc);
    return p;
  }, [cx, cy, sc]);

  return (
    <Group>
      <Circle cx={cx} cy={cy} r={size / 2} color="#22C55E" />
      <Path path={path} color="#FFFFFF" style="stroke" strokeWidth={2 * sc} />
    </Group>
  );
}

function QRIcon({ x, y, size, value }: { x: number; y: number; size: number; value: string }) {
  const qrModules = useMemo(() => {
    try {
      const d = QRCodeGenerator.create(value, { errorCorrectionLevel: 'H' });
      const data = Array.from(d.modules.data);
      return { data, count: Math.sqrt(data.length) };
    } catch { return { data: [] as number[], count: 0 }; }
  }, [value]);

  const sc = size / BASE_QR_SIZE;
  const pad = 3 * sc;
  const dotSize = qrModules.count > 0 ? (size - pad * 2) / qrModules.count : 0;
  const dots = useMemo(() => {
    const r: { row: number; col: number }[] = [];
    for (let i = 0; i < qrModules.data.length; i++)
      if (qrModules.data[i]) r.push({ row: Math.floor(i / qrModules.count), col: i % qrModules.count });
    return r;
  }, [qrModules]);

  return (
    <Group>
      <RoundedRect x={x} y={y} width={size} height={size} r={5 * sc} color="#FFFFFF" />
      {dots.map(({ row, col }, i) => (
        <Rect key={i} x={x + pad + col * dotSize} y={y + pad + row * dotSize}
          width={dotSize} height={dotSize} color={BADGE_BG} />
      ))}
    </Group>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: -9999, top: -9999, opacity: 0 },
});
