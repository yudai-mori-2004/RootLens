import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

// ARKit ベース撮影モジュールの薄ラッパー。
//
// startRecording は session ディレクトリ URL を引数に取り、 その配下に Pipeline 1 の
// 出力ファイル群 (= rgb.mp4 / realtime_handpose.jsonl / imu.jsonl / metadata.json /
// depth/ (Pro 機のみ)) を並走出力する。 詳細は document/v0.1.2/tasks/15-capture-baseline/README.md。
//
// 加えて 15 Hz でリアルタイムの手の検出結果を onHandTrack イベントで通知する。

export interface ArkitCapturePreviewProps extends ViewProps {}

// native (ArkitCapture) が未登録 (= まだ iOS ビルドに含まれていない) でも import 時に
// 落ちないよう try/catch する。 null の場合は UI 側でプレースホルダを出す。
export const ArkitCapturePreviewView: ComponentType<ArkitCapturePreviewProps> | null = (() => {
  try {
    return requireNativeViewManager<ArkitCapturePreviewProps>('ArkitCapture');
  } catch {
    return null;
  }
})();

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
  timestampNs: string;            // ARFrame.timestamp 由来 ns (= bigint 互換のため string)
  imageWidth: number;
  imageHeight: number;
  wearerHandCount: number;        // 0 / 1 / 2 (= ジェスチャ判定のみで使う)
  wearerHands: WearerHandObservation[];
  /// フレーミング判定の主信号: ARKit personSegmentation で「人」 と判定されたピクセル割合
  /// segmentationCoverage = 画面全体に対する人ピクセルの割合 (= 0..1)
  /// segmentationEdgeRatio = 人ピクセルのうち画面外周 8% 内側に居る割合 (= 0..1)
  segmentationCoverage: number;
  segmentationEdgeRatio: number;
}

/** 現在の表示 orientation。 native (ARKit / Vision) はこの値に従って frame の解釈と
 *  ジョイント座標系の補正をする。 録画中は変更しない (= MCAP intrinsics が固定でないと困る)。 */
export type DisplayOrientation = 'portrait' | 'landscapeLeft' | 'landscapeRight';

interface ArkitCaptureNativeModule {
  isAvailable(): Promise<boolean>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  /** sessionDir 配下に rgb.mp4 + realtime_handpose.jsonl + imu.jsonl + metadata.json
   *  を並走出力する。 空文字なら temp 配下に session ディレクトリを生成する。
   *  返値は session ディレクトリの file:// URI。 */
  startRecording(sessionDir: string): Promise<string>;
  /** 返値は startRecording の sessionDir をそのまま返す。 */
  stopRecording(): Promise<string>;
  captureSnapshot(): Promise<string>;
  setDisplayOrientation(orientation: DisplayOrientation): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule = requireOptionalNativeModule<ArkitCaptureNativeModule>('ArkitCapture');

export async function isArkitCaptureAvailable(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.isAvailable();
}

export async function startArkitSession(): Promise<void> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.startSession();
}

export async function stopArkitSession(): Promise<void> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.stopSession();
}

/** sessionDir 配下に rgb.mp4 + realtime_handpose.jsonl + imu.jsonl + metadata.json
 *  (+ Pro 機の depth/) を並走出力する。 空文字なら native 側で temp 配下に新規ディレクトリを生成。
 *  返値は session ディレクトリの file:// URI。 */
export async function startArkitRecording(sessionDir = ''): Promise<string> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.startRecording(sessionDir);
}

export async function stopArkitRecording(): Promise<string> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.stopRecording();
}

/** 現在の ARFrame を JPEG として temp に書き出して file:// URI を返す (VLM 用) */
export async function captureArkitSnapshot(): Promise<string> {
  if (!nativeModule) throw new Error('ArkitCapture native module unavailable');
  return nativeModule.captureSnapshot();
}

/** ARKit / Vision に伝える表示 orientation を更新。
 *  capture screen から ScreenOrientation listener を介して呼ぶ。
 *  録画開始前に最新値を確定させ、 録画中は変更しないこと (= MCAP intrinsics 固定のため)。 */
export async function setArkitDisplayOrientation(orientation: DisplayOrientation): Promise<void> {
  if (!nativeModule) return;
  return nativeModule.setDisplayOrientation(orientation);
}

/** イベント購読: 15 Hz で発火 */
export function subscribeHandTrack(listener: (e: HandTrackEvent) => void): { remove: () => void } {
  if (!nativeModule) return { remove: () => {} };
  // expo-modules-core の Module は EventEmitter インタフェースを継承している
  const sub = (nativeModule as any).addListener?.('onHandTrack', listener);
  if (sub && typeof sub.remove === 'function') return sub;
  // フォールバック (古い API)
  return { remove: () => (nativeModule as any).removeListeners?.(1) };
}
