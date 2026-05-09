import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

// Hand pose ネイティブモジュールの薄ラッパー。
//
// 設計:
//   - View 限定モジュール (Module 関数なし)。<HandPosePreviewView /> がカメラプレビューを描画し、
//     per-frame の onHandPose event で landmark を emit する
//   - schema は iOS / Android で完全一致 (HandPoseTypes.swift / HandPoseTypes.kt と同期)
//   - 21 landmark の index は MediaPipe HandLandmarker 規約 (HAND_LANDMARK_INDICES 参照)

/** MediaPipe 21-joint index 規約 */
export const HAND_LANDMARK_INDICES = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** 描画用の bone connections (MediaPipe HAND_CONNECTIONS と同等) */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [9, 10], [10, 11], [11, 12],
  // Ring
  [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm cross-links
  [5, 9], [9, 13], [13, 17],
];

/**
 * 1 landmark。座標は image top-left 原点で正規化 (0..1)。
 * z は MediaPipe の wrist-relative depth (Android のみ非ゼロ。iOS Vision は 2D で z=0 固定)。
 * confidence は 0..1 の visibility/presence。
 */
export interface HandLandmark {
  x: number;
  y: number;
  z: number;
  confidence: number;
}

/**
 * 1 つの手の検出結果。landmarks は必ず 21 要素。取得不能な joint は confidence=0 で埋まる。
 */
export interface HandObservation {
  handedness: 'left' | 'right' | 'unknown';
  score: number;
  landmarks: HandLandmark[];
}

/**
 * Per-frame event payload。timestamp_ns は ns 文字列 (bigint 互換のため)。
 * image_width / image_height は detector が見たフレーム解像度。
 */
export interface HandPoseEvent {
  timestamp_ns: string;
  image_width: number;
  image_height: number;
  hands: HandObservation[];
}

export interface HandPosePreviewProps extends ViewProps {
  /** true で frame 配信を停止 (overlay 残像確認用) */
  paused?: boolean;
  /** per-frame に呼ばれる。30fps 想定 */
  onHandPose?: (event: { nativeEvent: HandPoseEvent }) => void;
}

/**
 * 21-joint hand pose を取得しながらカメラプレビューを表示するネイティブ View。
 * 起動時にカメラ権限が許諾済みであること (expo-camera の requestCameraPermissionsAsync 等で事前確保)。
 */
export const HandPosePreviewView: ComponentType<HandPosePreviewProps> =
  requireNativeViewManager<HandPosePreviewProps>('HandPose');

// MARK: - Module-level functions (sandbox 04: collection flow)

interface HandPoseNativeModule {
  /** 直近 frame を JPEG 化して file:// URI を返す。HandPosePreviewView がマウント済みである必要 */
  captureSnapshot(): Promise<string>;
  /** mp4 録画開始。outputPath 空なら native 側で temp 生成。返値は file:// URI */
  startRecording(outputPath: string): Promise<string>;
  /** 録画停止。書き込み完了後に file:// URI 返却 */
  stopRecording(): Promise<string>;
}

const nativeModule = requireOptionalNativeModule<HandPoseNativeModule>('HandPose');

/**
 * 直近 camera frame を JPEG として一時ファイルに保存し file:// URI を返す。
 * HandPosePreviewView がマウントされて frame が流れている必要あり。
 */
export async function captureHandPoseSnapshot(): Promise<string> {
  if (!nativeModule) throw new Error('HandPose native module unavailable');
  return nativeModule.captureSnapshot();
}

/**
 * mp4 録画開始。outputPath 空なら native 側 temp 配下に生成。
 * HandPosePreviewView がマウントされている時のみ動作 (frame stream 駆動)。
 * 返値は出力 mp4 の file:// URI。
 */
export async function startHandPoseRecording(outputPath = ''): Promise<string> {
  if (!nativeModule) throw new Error('HandPose native module unavailable');
  return nativeModule.startRecording(outputPath);
}

/** 録画停止。AVAssetWriter の finalize 後に出力 URI を返す。 */
export async function stopHandPoseRecording(): Promise<string> {
  if (!nativeModule) throw new Error('HandPose native module unavailable');
  return nativeModule.stopRecording();
}
