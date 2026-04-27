import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

// 抽象センサー層のネイティブブリッジ薄ラッパー
//
// 設計: TS 側 SensorSession (app/src/sensors/SensorSession.ts) が
// 排他グループ解決などのロジックを持ち、本ラッパーは「ネイティブ呼び出し」のみ責務とする。

/**
 * ネイティブ層が「現状デバイスで使える sensor」を列挙して返すレコード。
 * exclusivity_group は null なら他センサーと並列起動可、文字列なら排他グループ識別子。
 * api_descriptor は OS API レスポンスから取れた固定メタ (例: AVCaptureDevice の uniqueID,
 * SensorManager の vendor / name 等)。
 */
export type NativeSensorDescriptor = {
  id: string;
  exclusivity_group: string | null;
  available: boolean;
  api_descriptor: Record<string, unknown>;
  unavailable_reason?: string;
};

/**
 * ネイティブ層からの capture 結果。bigint を JSON でやり取りできないため
 * timestamp は string (10 進ナノ秒) で受け取る。
 */
export type NativeSensorResult = {
  sensor_id: string;
  api_path: string;
  kind: 'point' | 'stream' | 'unavailable';
  payload: unknown;
  timestamp: {
    start_ns: string;
    end_ns: string;
  };
  unavailable_reason?: string;
};

interface SensorSessionNativeModule {
  /** 現状デバイスで列挙できる sensor 一覧を返す (登録時に1度呼ばれる想定) */
  listAvailableSensors(): Promise<NativeSensorDescriptor[]>;

  /**
   * 撮影窓に対して指定された sensor 群を並列 capture する。
   *  - sensorIds: TS 側で排他解決済みの sensor ID 配列
   *  - windowStartNs: 撮影窓開始 (ns、string で渡す)
   *  - windowDurationMs: 撮影窓長 (ms。0 なら単点 = 静止画)
   *  - windowLookbackMs: window 開始前のルックバック (ms)。IMU リングバッファ等が使う。0 なら無効
   */
  capture(
    sensorIds: string[],
    windowStartNs: string,
    windowDurationMs: number,
    windowLookbackMs: number
  ): Promise<NativeSensorResult[]>;

  /**
   * 動画 stream 録画開始 (Task 03)。streamId を返す。
   *  - sensorIds: 排他解決済みの sensor ID 配列
   *  - windowStartNs: 録画開始 wall-clock ns (assertion 同梱用)
   *  - windowLookbackMs: 録画開始前の IMU ルックバック ms
   *  - outputPath: mp4 の出力先 (空なら native がテンポラリ生成)
   */
  startStream(
    sensorIds: string[],
    windowStartNs: string,
    windowLookbackMs: number,
    outputPath: string
  ): Promise<string>;

  /**
   * 動画 stream 録画停止 (Task 03)。SensorCaptureResult[] を返す。
   * Camera sensor は payload.output_path に最終 mp4 のパスを含む。
   */
  stopStream(streamId: string): Promise<NativeSensorResult[]>;

  /** 録画中断 (録画放棄 + 出力ファイル削除) */
  abortStream(streamId: string): Promise<void>;

  /** カメラ切替 (Task 05): 'front' or 'back' */
  switchCamera(facing: 'front' | 'back'): Promise<void>;
}

let nativeImpl: SensorSessionNativeModule | null = null;
try {
  nativeImpl = requireNativeModule('SensorSession');
} catch {
  // モジュール未実装のスカフォールド段階では null。capture() を呼ぶと throw する。
  nativeImpl = null;
}

function ensureNative(): SensorSessionNativeModule {
  if (!nativeImpl) {
    throw new Error(
      `SensorSession native module is not available on ${Platform.OS}`
    );
  }
  return nativeImpl;
}

export async function nativeListAvailableSensors(): Promise<NativeSensorDescriptor[]> {
  if (!nativeImpl) return [];
  return nativeImpl.listAvailableSensors();
}

export async function nativeCapture(
  sensorIds: string[],
  windowStartNs: bigint,
  windowDurationMs: number,
  windowLookbackMs: number = 0
): Promise<NativeSensorResult[]> {
  return ensureNative().capture(
    sensorIds,
    windowStartNs.toString(),
    windowDurationMs,
    windowLookbackMs
  );
}

export async function nativeStartStream(
  sensorIds: string[],
  windowStartNs: bigint,
  windowLookbackMs: number,
  outputPath: string
): Promise<string> {
  return ensureNative().startStream(
    sensorIds,
    windowStartNs.toString(),
    windowLookbackMs,
    outputPath
  );
}

export async function nativeStopStream(
  streamId: string
): Promise<NativeSensorResult[]> {
  return ensureNative().stopStream(streamId);
}

export async function nativeAbortStream(streamId: string): Promise<void> {
  return ensureNative().abortStream(streamId);
}

export async function nativeSwitchCamera(facing: 'front' | 'back'): Promise<void> {
  return ensureNative().switchCamera(facing);
}

export function isSensorSessionNativeAvailable(): boolean {
  return nativeImpl !== null;
}
