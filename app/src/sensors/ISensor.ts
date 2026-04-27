import type {
  ExclusivityGroup,
  SensorCapability,
  SensorCaptureResult,
  TimeWindow,
} from './types';

/**
 * ISensor — 抽象センサー層の単位。Camera / Depth / IMU / GPS / 任意の将来センサーが
 * すべてこの interface を実装する。
 *
 * 撮影セッション (SensorSession) はここに登録された ISensor 群を並列起動する。
 * exclusivityGroup が同じ ISensor は SensorSession.capture() 時点で1個に絞られる。
 */
export interface ISensor {
  /** 一意な ID。assertion ラベルにも使う (例: "ios.core_motion.device_motion") */
  readonly id: string;

  /**
   * 排他グループ。null なら他センサーとフラットに並列起動可。
   * 例:
   *  - "ios.av_session"   : AVCaptureSession 系 + ARSession 系 (同時起動不可)
   *  - "android.camera2"  : Camera2 系 + ARCore Session (同時起動不可)
   * 同 group 内の ISensor は SensorSession 側で選択される。
   */
  readonly exclusivityGroup: ExclusivityGroup;

  /** デバイスでこの sensor が使えるか + OS API から取れた固定メタを返す */
  capability(): Promise<SensorCapability>;

  /** 撮影窓に対して capture を実行。capture 失敗時は kind='unavailable' を返す */
  capture(window: TimeWindow): Promise<SensorCaptureResult>;
}
