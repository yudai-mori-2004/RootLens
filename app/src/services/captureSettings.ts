// 撮影設定。 AsyncStorage に永続化し、 撮影画面を開くたび native (ArkitCaptureController) へ渡す。
// 適用は次の ARSession 起動から。
//
// 解像度の既定は 4:3 フルセンサー (= 1x 最大画角) の 1440p。 16:9 切り出しの
// 1080p / 720p は任意選択とする。

import AsyncStorage from '@react-native-async-storage/async-storage';

import { setArkitCaptureSettings } from '../native/arkitCapture';

export type CaptureResolution = '1440p' | '1080p' | '720p';
export type RecordingRate = 15 | 30 | 60;
export type ImuRate = 50 | 100 | 200;

export interface CaptureSettings {
  resolution: CaptureResolution;
  autoFocus: boolean;
  /** false でセッション安定後に露出をロックする (蛍光灯フリッカー等の対策)。 */
  autoExposure: boolean;
  /** ARKit へ要求するセンサー fps。 実効値はフォーマット選択の結果に従う。 */
  arkitFps: 30 | 60;
  /** RGB / depth / point cloud の書き出し Hz。 sync 時は 3 ストリーム共通。 */
  recordingRate: RecordingRate;
  syncRate: boolean;
  depthRate: RecordingRate;
  pointCloudRate: RecordingRate;
  imuRateHz: ImuRate;
  streamImu: boolean;
  streamDepth: boolean;
  streamPointCloud: boolean;
  streamMesh: boolean;

  // ── 撮影フロー (= 開始・終了の指示方法。 UI 層の挙動なので native へは渡らない) ──
  /** 'gesture' = サムズアップ停止 (従来) / 'voice' = 音声コマンドで開始・終了。 */
  captureFlow: 'gesture' | 'voice';

  // ── 自動サイクル撮影 (= 長時間シフト用。 UI 層の挙動なので native へは渡らない) ──
  // N 分録画 → 自動停止 (= 1 クリップ確定) → M 分休止 (= ARKit 停止で冷却) → 再開案内 +
  // パーのキャリブレーションに戻る、 を繰り返す。 各クリップは独立エピソード。
  /** 自動サイクルを有効にするか。 false なら従来どおりジェスチャーで手動停止。 */
  cycleEnabled: boolean;
  /** 1 サイクルの連続撮影時間 (分)。 */
  cycleRecordMinutes: number;
  /** 各サイクル間の休止時間 (分)。 */
  cyclePauseMinutes: number;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  resolution: '1440p',
  autoFocus: true,
  autoExposure: true,
  arkitFps: 30,
  // RGB-D の既定は 30 Hz (= 収録仕様は 1920×1440・30fps。 LP のスペック表と対)。
  // sync 時は depth / point cloud も追従する。
  // ⚠ これは初期値の宣言のみ。 fps は撮影設定として native へ渡るだけで、 実行時に別経路で
  //    fps を書き換えるコードは持たせない (= ユーザーが設定画面で選んだ値がそのまま効く)。
  recordingRate: 30,
  syncRate: true,
  depthRate: 30,
  pointCloudRate: 30,
  imuRateHz: 100,
  streamImu: true,
  streamDepth: true,
  streamPointCloud: true,
  streamMesh: true,
  captureFlow: 'gesture',
  cycleEnabled: false,
  cycleRecordMinutes: 30,
  cyclePauseMinutes: 5,
};

const STORAGE_KEY = '@rootlens/capture-settings/v1';

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CAPTURE_SETTINGS };
    return { ...DEFAULT_CAPTURE_SETTINGS, ...(JSON.parse(raw) as Partial<CaptureSettings>) };
  } catch {
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
}

export async function saveCaptureSettings(settings: CaptureSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** 保存済み設定を native へ反映する。 撮影画面が ARSession を起動する前に呼ぶ。 */
export async function applyCaptureSettingsToNative(): Promise<void> {
  const settings = await loadCaptureSettings();
  await setArkitCaptureSettings(JSON.stringify(settings));
}
