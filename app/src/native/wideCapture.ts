import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

// AVCaptureSession ベース撮影モジュールの薄ラッパー (= 2026-05-27 大方針転換、 ARKit 撤去後)。
//
// startRecording は session ディレクトリ URL を引数に取り、 その配下に超広角構成の
// 出力ファイル (= rgb.mp4 / realtime_handpose.jsonl / metadata.json) を並走出力する
// (= DATA_SPECS §2.2「超広角構成」)。
//
// onHandTrack event の payload shape は arkit-capture と完全同形 (= 段階削除中の互換)。
// segmentationCoverage / segmentationEdgeRatio は新仕様で hand framing 判定が撤去された
// ため native 側で 0.0 固定で送る。

export interface WideCapturePreviewProps extends ViewProps {}

export const WideCapturePreviewView: ComponentType<WideCapturePreviewProps> =
  requireNativeViewManager<WideCapturePreviewProps>('WideCapture');

/** 21 関節 (MediaPipe 順) の手のランドマーク 1 個 */
export interface HandLandmark {
  x: number;        // 0..1 (左上原点)
  y: number;        // 0..1
  confidence: number;
}

/** 1 つの手の検出結果 */
export interface WearerHandObservation {
  handedness: 'left' | 'right' | 'unknown';
  confidence: number;
  landmarks: HandLandmark[];   // 必ず 21 要素
  /// この手単体のジェスチャー (= native per-hand 判定。 検出不能は null)。 集約は TS 側。
  gesture: 'open_palm' | 'thumbs_up' | null;
}

/** 検出された 1 つのフレームの手の状態。 frame-level gesture は廃止 (= per-hand を TS で集約)。 */
export interface HandTrackEvent {
  timestampNs: string;             // CMSampleBuffer.presentationTimeStamp 由来 ns (bigint 互換 string)
  imageWidth: number;
  imageHeight: number;
  wearerHandCount: number;         // 0 / 1 / 2
  wearerHands: WearerHandObservation[];
  /// 互換性のためのフィールド。 2026-05-27 hand framing 判定撤去で常に 0.0
  segmentationCoverage: number;
  segmentationEdgeRatio: number;
}

/** 表示 orientation。 native (= AVCaptureSession videoOrientation) はこの値で frame を回す。 */
export type DisplayOrientation = 'portrait' | 'landscapeLeft' | 'landscapeRight';

interface WideCaptureNativeModule {
  isAvailable(): Promise<boolean>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  /** sessionDir 配下に rgb.mp4 + realtime_handpose.jsonl + metadata.json を並走出力する。
   *  空文字なら temp 配下に session ディレクトリを生成する。
   *  返値は session ディレクトリの file:// URI。 */
  startRecording(sessionDir: string): Promise<string>;
  /** 返値は startRecording の sessionDir をそのまま返す。 */
  stopRecording(): Promise<string>;
  captureSnapshot(): Promise<string>;
  setDisplayOrientation(orientation: DisplayOrientation): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule = requireOptionalNativeModule<WideCaptureNativeModule>('WideCapture');

export async function isWideCaptureAvailable(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.isAvailable();
}

export async function startWideSession(): Promise<void> {
  if (!nativeModule) throw new Error('WideCapture native module unavailable');
  return nativeModule.startSession();
}

export async function stopWideSession(): Promise<void> {
  if (!nativeModule) throw new Error('WideCapture native module unavailable');
  return nativeModule.stopSession();
}

export async function startWideRecording(sessionDir = ''): Promise<string> {
  if (!nativeModule) throw new Error('WideCapture native module unavailable');
  return nativeModule.startRecording(sessionDir);
}

export async function stopWideRecording(): Promise<string> {
  if (!nativeModule) throw new Error('WideCapture native module unavailable');
  return nativeModule.stopRecording();
}

/** 最新フレームを JPEG として temp に書き出して file:// URI を返す (= 次タスク提案 VLM 用) */
export async function captureWideSnapshot(): Promise<string> {
  if (!nativeModule) throw new Error('WideCapture native module unavailable');
  return nativeModule.captureSnapshot();
}

/** capture screen から ScreenOrientation listener 経由で呼ぶ。
 *  録画開始前に最新値を確定させること (= intrinsics 固定のため録画中は変更しない)。 */
export async function setWideDisplayOrientation(orientation: DisplayOrientation): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setDisplayOrientation(orientation);
}

/** イベント購読: AVCaptureSession の sample buffer ごとに発火 (= ~30 Hz) */
export function subscribeWideHandTrack(listener: (e: HandTrackEvent) => void): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  const sub = (nativeModule as any).addListener?.('onHandTrack', listener);
  if (sub && typeof sub.remove === 'function') return sub;
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}
