// 撮影設定 (= Stera アプリと同構成の選択肢)。 AsyncStorage に永続化し、 撮影画面を開くたび
// native (ArkitCaptureController) へ渡す。 適用は次の ARSession 起動から。
//
// 解像度だけ Stera (720p/1080p) と選択肢が違う: うちは 4:3 フルセンサー (= 1x 最大画角) を
// デフォルトにし、 16:9 切り出しの 1080p / 720p は任意選択とする。

import AsyncStorage from '@react-native-async-storage/async-storage';

import { setArkitCaptureSettings } from '../native/arkitCapture';

export type CaptureResolution = '1440p' | '1080p' | '720p';
export type RecordingRate = 15 | 30 | 60;
export type ImuRate = 50 | 100 | 200;

export interface CaptureSettings {
  resolution: CaptureResolution;
  autoFocus: boolean;
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
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  resolution: '1440p',
  autoFocus: true,
  // RGB-D の既定は 15 Hz (= Stera のネイティブ仕様に合わせる。 製品ページ「RGB-D 15 Hz」+
  // Stera-10M が 10M frames / 200h ≈ 14 fps)。 sync 時は depth / point cloud も追従する。
  // ⚠ これは初期値の宣言のみ。 fps は撮影設定として native へ渡るだけで、 実行時に別経路で
  //    fps を書き換えるコードは持たせない (= ユーザーが設定画面で選んだ値がそのまま効く)。
  recordingRate: 15,
  syncRate: true,
  depthRate: 15,
  pointCloudRate: 15,
  imuRateHz: 100,
  streamImu: true,
  streamDepth: true,
  streamPointCloud: true,
  streamMesh: true,
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
