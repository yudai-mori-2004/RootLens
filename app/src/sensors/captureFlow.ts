import type { C2paAssertion } from '../native/c2paBridge';
import { SensorSession } from './SensorSession';
import { createDefaultSensorSession } from './registry';
import type {
  SensorCaptureResult,
  SensorSessionResult,
  StreamCaptureOptions,
  StreamHandle,
  TimeWindow,
} from './types';

// 撮影フロー全体の TS 側オーケストレーション。
//
// 役割:
//  - グローバル SensorSession の lazy 初期化
//  - capture window 作成 (端末 monotonic 時刻は CameraSensor / IMU の payload から逆算する)
//  - SensorCaptureResult[] → C2pa assertion[] への変換
//  - 撮影 Camera result から output_path を取り出す

let cachedSession: SensorSession | null = null;
let cachedSessionInit: Promise<SensorSession> | null = null;

export async function getDefaultSensorSession(): Promise<SensorSession> {
  if (cachedSession) return cachedSession;
  if (cachedSessionInit) return cachedSessionInit;
  cachedSessionInit = (async () => {
    const { session } = await createDefaultSensorSession();
    cachedSession = session;
    return session;
  })();
  return cachedSessionInit;
}

/**
 * 撮影窓を生成する。
 *  - startNs は JS Date.now() ベース (millisecond 精度を ns 表現)
 *  - これは native の monotonic 時刻軸とは異なるが、撮影 capture では
 *    "now" を起点に IMU の lookback 範囲を切り出すための参照値として使う。
 *  - native 側は CameraSensor が capture 開始時点で自身の monotonic ns を
 *    結果の timestamp に書き込み、IMU sensor も同じ時間軸 (mach_absolute_time /
 *    SystemClock.elapsedRealtimeNanos) で payload を返す。
 *  - 厳密な HW timestamp 突き合わせは Task 03 (動画) でフレーム単位で行う。
 *  - 静止画用途では window は IMU lookback 切り出しの目安としてのみ使われる。
 */
export function makeStaticPhotoWindow(lookbackMs: number = 1000): TimeWindow {
  const nowMs = Date.now();
  const startNs = BigInt(nowMs) * 1_000_000n;
  return { startNs, durationMs: 0, lookbackMs };
}

/**
 * 動画撮影窓 (Task 03 で使用)。本タスクでは静止画のみ。
 */
export function makeVideoWindow(durationMs: number, lookbackMs: number = 0): TimeWindow {
  const nowMs = Date.now();
  const startNs = BigInt(nowMs) * 1_000_000n;
  return { startNs, durationMs, lookbackMs };
}

/**
 * Camera 由来 SensorCaptureResult から出力ファイルパスを取り出す。
 * 静止画 (kind='point', JPEG) も動画 (kind='stream', mp4) も同じく payload.output_path に格納される。
 */
export function findCapturedPhotoPath(results: SensorCaptureResult[]): string | null {
  for (const r of results) {
    if (r.kind === 'unavailable') continue;
    const p = (r.payload as Record<string, unknown> | null)?.output_path;
    if (typeof p === 'string' && p.length > 0) return p;
  }
  return null;
}

/**
 * SensorCaptureResult[] を C2PA assertion 配列に変換する。
 *
 * ラベル規則: `io.rootlens.capture.<sensor api_path>`
 * data: kind / timestamp / payload / unavailable_reason をそのまま埋める。
 *
 * 思想 (Don't be the judge):
 *  - 各 sensor が返したものをそのまま assertion に入れる。RootLens 側で正規化や分類はしない。
 *  - kind='unavailable' な結果も assertion として残す ("取れなかった事実" が consumer 側で意味を持つ)。
 */
export function buildAssertionsFromResults(
  results: SensorCaptureResult[],
  windowMeta?: { startNs: bigint; durationMs: number; lookbackMs: number }
): C2paAssertion[] {
  const assertions: C2paAssertion[] = results.map((r) => ({
    label: `io.rootlens.capture.${r.api_path}`,
    data: {
      kind: r.kind,
      timestamp: {
        start_ns: r.timestamp.startNs.toString(),
        end_ns: r.timestamp.endNs.toString(),
      },
      payload: r.payload,
      ...(r.unavailable_reason ? { unavailable_reason: r.unavailable_reason } : {}),
    },
  }));

  if (windowMeta) {
    assertions.push({
      label: 'io.rootlens.capture.window',
      data: {
        start_ns: windowMeta.startNs.toString(),
        duration_ms: windowMeta.durationMs,
        lookback_ms: windowMeta.lookbackMs,
        wall_clock_ms: Date.now(),
      },
    });
  }

  return assertions;
}

/**
 * 動画 stream を開始する (Task 03)。返した StreamHandle で停止する。
 */
export async function startVideoStream(
  opts: StreamCaptureOptions = {}
): Promise<StreamHandle> {
  const session = await getDefaultSensorSession();
  return session.startStream({ lookbackMs: 1000, ...opts });
}

/**
 * 動画 stream を停止 → SensorSessionResult を取り出して、
 * Camera 由来の output_path (mp4) と sensor assertions を返す。
 * 呼び出し側はこの mp4 + assertions を c2paBridge.signContent に渡す。
 */
export async function stopVideoStream(
  handle: StreamHandle
): Promise<{ result: SensorSessionResult; videoPath: string; assertions: C2paAssertion[] }> {
  const result = await handle.stop();
  const videoPath = findCapturedPhotoPath(result.results);
  if (!videoPath) {
    throw new Error('stopVideoStream: no video output path in stream results');
  }
  const assertions = buildAssertionsFromResults(result.results, {
    startNs: result.window.startNs,
    durationMs: result.window.durationMs,
    lookbackMs: result.window.lookbackMs ?? 0,
  });
  return { result, videoPath, assertions };
}
