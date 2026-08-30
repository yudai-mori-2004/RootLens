// 撮影設定。 AsyncStorage に永続化し、 撮影画面を開くたびローカル撮影 backend へ渡す。
// 適用は次の camera session 起動から。
//
// 解像度の既定は 4:3 フルセンサー (= 1x 最大画角) の 1440p。 16:9 切り出しの
// 1080p / 720p は任意選択とする。

import AsyncStorage from '@react-native-async-storage/async-storage';

import { setArkitCaptureSettings } from '../native/arkitCapture';
import { setIphoneCaptureSettings } from '../native/iphoneCapture';
import type { CaptureMethodId, DisplayOrientation } from '../dataflow/recording-configs';
import { isCaptureFlowId, type CaptureFlowId } from '../domain/captureFlowId';

export type CaptureResolution = '1440p' | '1080p' | '720p';
export type RecordingRate = 15 | 30 | 60;
export type ImuRate = 50 | 100 | 200;

export interface CaptureSettings {
  /** User-facing capture method. Mentra is external and therefore has no local RecordingConfig. */
  captureMethodId: CaptureMethodId;
  /** Landscape side used by both the app UI and local camera backends. */
  displayOrientation: DisplayOrientation;
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
  /** 開始・終了の操作戦略。 実装は captureFlow registry に並列登録する。 */
  captureFlow: CaptureFlowId;

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
  captureMethodId: 'arkit',
  displayOrientation: 'landscapeRight',
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

const STORAGE_KEY = '@rootlens/capture-settings/v2';
const LEGACY_STORAGE_KEY = '@rootlens/capture-settings/v1';
const listeners = new Set<(settings: CaptureSettings) => void>();

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  try {
    const currentRaw = await AsyncStorage.getItem(STORAGE_KEY);
    const legacyRaw = currentRaw ? null : await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    const raw = currentRaw ?? legacyRaw;
    if (!raw) return { ...DEFAULT_CAPTURE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CaptureSettings> & { recordingConfigId?: string };
    // `recordingConfigId` was used briefly before external Mentra was modeled
    // separately. Read it only as a migration alias; new writes use the
    // semantically correct settings-level captureMethodId.
    const storedMethod = parsed.captureMethodId ?? parsed.recordingConfigId;
    const captureMethodId: CaptureMethodId =
      storedMethod === 'arkit' || storedMethod === 'mentra' || storedMethod === 'iphone'
        ? storedMethod
        : DEFAULT_CAPTURE_SETTINGS.captureMethodId;
    const captureFlow = isCaptureFlowId(parsed.captureFlow)
      ? parsed.captureFlow
      : DEFAULT_CAPTURE_SETTINGS.captureFlow;
    let displayOrientation: DisplayOrientation =
      parsed.displayOrientation === 'landscapeLeft' || parsed.displayOrientation === 'landscapeRight'
        ? parsed.displayOrientation
        : DEFAULT_CAPTURE_SETTINGS.displayOrientation;
    // v1 labeled UIInterfaceOrientation.landscapeLeft as "port on left" and
    // vice versa. Preserve the side the user selected while migrating to the
    // correct iOS orientation value.
    if (legacyRaw) {
      displayOrientation = displayOrientation === 'landscapeLeft'
        ? 'landscapeRight'
        : 'landscapeLeft';
    }
    const { recordingConfigId: _legacyRecordingConfigId, ...current } = parsed;
    void _legacyRecordingConfigId;
    const settings = {
      ...DEFAULT_CAPTURE_SETTINGS,
      ...current,
      captureMethodId,
      displayOrientation,
      captureFlow,
      // ARKitデータ契約でimu.jsonlは必須。旧保存値falseもここで移行する。
      streamImu: true,
    };
    if (legacyRaw) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return settings;
  } catch {
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
}

export async function saveCaptureSettings(settings: CaptureSettings): Promise<void> {
  const displayOrientation: DisplayOrientation =
    settings.displayOrientation === 'landscapeLeft' ? 'landscapeLeft' : 'landscapeRight';
  const normalized = { ...settings, displayOrientation, streamImu: true };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  listeners.forEach((listener) => listener(normalized));
}

export function subscribeCaptureSettings(listener: (settings: CaptureSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 保存済み設定を native へ反映する。 撮影画面が camera session を起動する前に呼ぶ。 */
export async function applyCaptureSettingsToNative(): Promise<void> {
  const settings = await loadCaptureSettings();
  const json = JSON.stringify(settings);
  await Promise.all([
    setArkitCaptureSettings(json),
    setIphoneCaptureSettings(json),
  ]);
}
