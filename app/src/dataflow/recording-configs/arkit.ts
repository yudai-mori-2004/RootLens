// ARKit 構成 (DATA_SPECS §2.2「ARKit 構成」)。iOS 限定。
//
// ARKit world tracking + 背面 wide camera (1x)。6DoF カメラポーズ・IMU・LiDAR 深度 (Pro 端末のみ) を
// 同期取得する。超広角構成より画角が狭く発熱が大きい。native は arkit-capture module。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。
//    native module wrapper (../../native/arkitCapture) は内部で react-native を使うが、
//    ここが import するのは関数 export のみ (= React component は触らない)。

import {
  isArkitCaptureAvailable,
  startArkitSession,
  stopArkitSession,
  startArkitRecording,
  stopArkitRecording,
} from '../../native/arkitCapture';
import type { EventSink } from '../events';
import type { OutputFileSpec, RecordingConfig, RecordingSession } from './types';

// ARKit 構成の出力ファイル (DATA_SPECS §2.2):
//   rgb.mp4                    wide (1x) RGB 映像 (30 fps)
//   realtime_handpose.jsonl    手ランドマーク (= ultra_wide と同形の hands) + カメラポーズ (4×4) + tracking_state + IMU snapshot
//   imu.jsonl                  加速度 / ジャイロ / デバイスモーション (~100 Hz)
//   metadata.json              機種 / OS / アプリ版 / カメラ画角・解像度・intrinsics / 構成 ID 等の静的情報
//   depth/<frame>.png          LiDAR 深度 (Pro 端末のみ、 可変枚数)。 単一ファイルではないので outputFiles には含めず、
//                              現状アップロード対象外 (= 仕様 §3.2「存在すれば使い、 なければスキップ」)。
const OUTPUT_FILES: OutputFileSpec[] = [
  { name: 'rgb.mp4', contentType: 'video/mp4', required: true, isPrimaryVideo: true },
  { name: 'realtime_handpose.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'imu.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'metadata.json', contentType: 'application/json', required: true },
];

function ensureTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

export const arkitConfig: RecordingConfig = {
  id: 'arkit',
  label: 'ARKit (wide 1x + 6DoF + LiDAR)',
  platform: 'ios',
  outputFiles: OUTPUT_FILES,

  async isAvailable() {
    return isArkitCaptureAvailable();
  },

  async startSession(sink: EventSink) {
    sink({ step: 'record', level: 'info', message: 'ARKit session を開始' });
    await startArkitSession();
    sink({ step: 'record', level: 'success', message: 'session 開始完了 (プレビュー稼働)' });
  },

  async stopSession(sink: EventSink) {
    sink({ step: 'record', level: 'info', message: 'ARKit session を停止' });
    await stopArkitSession();
    sink({ step: 'record', level: 'success', message: 'session 停止完了' });
  },

  async startRecording(sink: EventSink): Promise<RecordingSession> {
    sink({ step: 'record', level: 'info', message: '録画開始 (ARKit)' });
    const dir = await startArkitRecording();
    const sessionDir = ensureTrailingSlash(dir);
    sink({ step: 'record', level: 'success', message: '録画開始完了', detail: { sessionDir } });
    return { sessionDir };
  },

  async stopRecording(sink: EventSink): Promise<RecordingSession> {
    sink({ step: 'record', level: 'info', message: '録画停止 (ARKit)' });
    const dir = await stopArkitRecording();
    const sessionDir = ensureTrailingSlash(dir);
    sink({
      step: 'record',
      level: 'success',
      message: '録画停止完了',
      detail: { sessionDir, files: OUTPUT_FILES.map((f) => f.name) },
    });
    return { sessionDir };
  },

  primaryVideoUri(session: RecordingSession): string {
    const primary = OUTPUT_FILES.find((f) => f.isPrimaryVideo);
    if (!primary) throw new Error('arkit config has no primary video file');
    return `${ensureTrailingSlash(session.sessionDir)}${primary.name}`;
  },
};
