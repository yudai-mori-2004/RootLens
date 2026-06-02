import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

// On-device privacy blur unit (SPECS §2.3 step 7)。
//
// 入力 mp4 の **顔** を Gaussian blur で隠した (= 顔マスキング) mp4 を出力する。
// 「匿名化」とは呼ばない: 声・体・間取り等で再識別余地が残るため、 これは合法性の根拠でなく
// 偶発第三者向けの補助的リスク低減層 (= legal/legal-policy D1/D5)。
// iOS のみ実装 (Vision + CoreImage + Metal)。Android は後続タスク。
//
// 想定 caller:
//   sandbox 04 collection-flow → 録画完了 → processPrivacyBlur(...) → ユーザー承認 → TP register
//
// テキスト blur 非対応 (本ユニットでは):
//   VNRecognizeTextRequest は recognizer であって detector ではない。
//   PC 画面のような密集シーンで recall hole / 視点崩れ / 1 字 noise / 4-pass
//   false positive など制御不能な不安定性が出る。
//   2026 年時点で iOS 純正の text-region detector は未提供で、production 解は
//   DBNet / PP-OCRv5_det を CoreML 化する別ユニット (1.5-2 週間)。
//   本ユニットは顔のみでスコープを切り、text は後続タスクとして分離する。
//
// 性能想定 (5-min 1080p mp4, 顔のみ):
//   - iPhone 14/15: ~1-2min wall time
//   - iPhone 16+:   <1min
//   - face detect 3-8ms/frame、HW encoder は律速にならない

export interface PrivacyBlurOptions {
  /** 入力 mp4 (file:// または絶対パス) */
  inputUri: string;
  /** 出力 mp4 (省略時は temp に作成) */
  outputUri?: string;
  /** Gaussian blur radius (px)。default 32。プライバシー上 16 以上推奨 */
  blurRadius?: number;
  /** 検出時のダウンサンプル比 (0.25-1.0)。default 0.66 で 1080p → 720p 相当 */
  detectionScale?: number;
  /** 顔 bbox の拡張率 (毛髪・顎まで覆う)。default 0.18 */
  faceInflate?: number;
}

export interface PrivacyBlurResult {
  /** 処理済 mp4 の file:// URI */
  outputUri: string;
  /** 全体処理 wall time (ms) */
  durationMs: number;
  /** 処理したフレーム数 */
  framesProcessed: number;
  /** 全フレーム合計の検出顔数 (重複あり、frame 毎の累積) */
  facesBlurred: number;
  /** 入力ファイルサイズ (bytes) */
  inputBytes: number;
  /** 出力ファイルサイズ (bytes) */
  outputBytes: number;
  /** 出力動画の表示幅 (px) */
  outputWidth: number;
  /** 出力動画の表示高 (px) */
  outputHeight: number;
  /** 実際にぼかした領域の per-frame 記録 (= C2PA blur assertion の元データ)。
   *  顔が検出されたフレームのみ。座標は upright フレームの top-left 原点・正規化 [0,1]。 */
  blurRegions: BlurFrameRegions[];
}

/** 1 フレーム分の blur 領域 (= 顔 bbox 群)。native PrivacyBlur の dict キーと一致させる。 */
export interface BlurFrameRegions {
  frame_index: number;
  regions: Array<{ x: number; y: number; w: number; h: number }>;
}

export interface PrivacyBlurProgress {
  /** 0..1 */
  progress: number;
  framesDone: number;
  totalFrames: number;
}

interface NativePrivacyBlur {
  process(args: PrivacyBlurOptions): Promise<PrivacyBlurResult>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  addListener(
    eventName: 'onProgress',
    listener: (event: PrivacyBlurProgress) => void,
  ): EventSubscription;
}

const nativeModule = requireOptionalNativeModule<NativePrivacyBlur>('PrivacyBlur');

/**
 * 入力 mp4 を読み、顔領域をブラーして新しい mp4 として書き出す。
 *
 * @returns 出力 file:// URI と統計情報
 * @throws ネイティブモジュール未ロード / 入力ファイル不在 / writer 失敗等
 */
export async function processPrivacyBlur(
  options: PrivacyBlurOptions,
  onProgress?: (p: PrivacyBlurProgress) => void,
): Promise<PrivacyBlurResult> {
  if (!nativeModule) {
    throw new Error('PrivacyBlur native module unavailable (iOS only; rebuild required)');
  }
  let subscription: EventSubscription | undefined;
  if (onProgress) {
    subscription = nativeModule.addListener('onProgress', onProgress);
  }
  try {
    return await nativeModule.process(options);
  } finally {
    subscription?.remove();
  }
}

/** Module が現環境 (OS / build) でロード可能か */
export function isPrivacyBlurAvailable(): boolean {
  return nativeModule != null;
}
