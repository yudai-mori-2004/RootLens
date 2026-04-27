// 抽象センサー層 — 共通型定義
// v0.1.1 Task 02 (Phase 1)
//
// 設計思想:
//   - Don't be the judge: OS API レスポンスをそのまま記録する。
//     RootLens は raw / fused / 物理 / ML 等の判定や分類を持たない。
//   - Sensor is the architecture core, camera is one of them: Camera は
//     ISensor の1実装にすぎず、IMU / Depth と等価に扱う。

/**
 * 撮影窓。durationMs=0 は単点 (静止画)、>0 はストリーム (動画。Task 03 で本対応)。
 * startNs は端末 monotonic clock のナノ秒 (iOS: mach_continuous_time 系 /
 * Android: SystemClock.elapsedRealtimeNanos) 。
 *
 * lookbackMs は IMU 等のリングバッファ系 sensor が「window 開始の前にどれだけ
 * 遡って sample を含めるか」を表す。撮影前後のモーションを記録する用途。
 * 0 ならルックバックなし。Phase 5 (CameraScreen) で静止画は 1000ms 程度を既定にする想定。
 */
export type TimeWindow = {
  startNs: bigint;
  durationMs: number;
  lookbackMs?: number;
};

/**
 * ISensor が排他グループに属するときの識別子。null なら他センサーと並列起動可。
 * 例: "ios.av_session" (AVCaptureSession + ARSession 系の排他)、
 *     "android.camera2" (Camera2 + ARCore Session の排他)。
 */
export type ExclusivityGroup = string | null;

/**
 * Sensor がそのデバイスで利用可能かと、OS API レスポンスから取れた固定メタデータ。
 *
 * api_descriptor は OS API のレスポンスをそのまま JSON 化した値のみを含む。
 * RootLens 独自の分類ラベル (T0 / I0 等) は持たない。
 */
export type SensorCapability = {
  available: boolean;
  api_descriptor: Record<string, unknown>;
  /** capability 取得失敗時の補助情報 (権限拒否、デバイス未対応 等) */
  unavailable_reason?: string;
};

/**
 * 撮影結果の種類。
 *  - point      : 単点 (静止画 / 撮影瞬間の値 1 個)
 *  - stream     : ストリーム (動画。Task 03 で本対応。詳細フィールドは追加予定)
 *  - unavailable: 取得失敗・対応外
 */
export type SensorResultKind = 'point' | 'stream' | 'unavailable';

/**
 * 1 ISensor = 1 SensorCaptureResult。
 *
 * payload は OS API レスポンスをそのまま JSON-serializable に変換した値のみ。
 * RootLens 側の解釈・付加情報は入れない。
 */
export type SensorCaptureResult = {
  /** ISensor.id と一致 */
  sensor_id: string;
  /** C2PA assertion ラベル構成材料 (例: "ios.core_motion.device_motion") */
  api_path: string;
  kind: SensorResultKind;
  /** OS API レスポンス本体 */
  payload: unknown;
  timestamp: {
    /** 撮影窓相対の取得開始 (point の場合は capture 瞬間) */
    startNs: bigint;
    /** 撮影窓相対の取得終了 (point の場合は startNs と同じ) */
    endNs: bigint;
  };
  /** kind='unavailable' のときに理由を入れる */
  unavailable_reason?: string;
};

/**
 * SensorSession.capture() の戻り値。
 * 失敗した sensor も unavailable kind として含まれる。
 */
export type SensorSessionResult = {
  window: TimeWindow;
  results: SensorCaptureResult[];
};

/**
 * 動画ストリーム capture のオプション (Task 03)。
 *  - lookbackMs: 録画開始前の IMU ルックバック ms (assertion inline、CAMM track には乗らない)
 *  - outputPath: 録画 mp4 の出力先。省略時は native 側でテンポラリパスを生成
 */
export type StreamCaptureOptions = {
  lookbackMs?: number;
  outputPath?: string;
};

/**
 * SensorSession.startStream() の戻り値。stop() で結果を取得する。
 */
export interface StreamHandle {
  readonly streamId: string;
  /** 録画停止 + 結果取得。すべての sensor が flush + close される */
  stop(): Promise<SensorSessionResult>;
  /** 中断 (録画放棄、ファイル削除)。エラー時のクリーンアップ用 */
  abort(): Promise<void>;
}
