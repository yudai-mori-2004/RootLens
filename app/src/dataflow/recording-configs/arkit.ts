// ARKit 構成 (DATA_SPECS §2.2「ARKit 構成」)。iOS 限定。
//
// ARKit world tracking + 背面 wide camera (1x)。6DoF カメラポーズ・IMU・LiDAR 深度 (Pro 端末のみ) を
// 同期取得する。超広角構成より画角が狭く発熱が大きい。native は arkit-capture module。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。
//    native module wrapper (../../native/arkitCapture) は内部で react-native を使うが、
//    ここが import するのは関数 export のみ (= React component は触らない)。

import * as FileSystem from 'expo-file-system';

import {
  isArkitCaptureAvailable,
  startArkitSession,
  stopArkitSession,
  startArkitRecording,
  stopArkitRecording,
  captureArkitSnapshot,
  setArkitDisplayOrientation,
  subscribeHandTrack as subscribeArkitHandTrack,
} from '../../native/arkitCapture';
import type { EventSink } from '../events';
import type {
  DisplayOrientation,
  HandTrackEvent,
  HandTrackSubscription,
  OutputFileSpec,
  RecordingConfig,
  RecordingSession,
} from './types';

// ARKit 構成の出力ファイル (DATA_SPECS §2.2):
//   rgb.mp4                    wide (1x) RGB 映像 (30 fps)
//   realtime_handpose.jsonl    手ランドマーク (= ultra_wide と同形の hands) + カメラポーズ (4×4) + tracking_state + IMU snapshot
//   imu.jsonl                  加速度 / ジャイロ / デバイスモーション (~100 Hz)
//   metadata.json              機種 / OS / アプリ版 / カメラ画角・解像度・intrinsics / 構成 ID 等の静的情報
//   depth.tar                  LiDAR 深度 (Pro 端末のみ)。 native が 16-bit PNG (mm) / フレームを
//                              1 本の tar に streaming 追記したもの (= RGB-D 標準形式を単一ファイル化)。
//                              非 LiDAR 機では生成されない → required:false で「あれば上げる」。
const OUTPUT_FILES: OutputFileSpec[] = [
  { name: 'rgb.mp4', contentType: 'video/mp4', required: true, isPrimaryVideo: true },
  { name: 'realtime_handpose.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'imu.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'metadata.json', contentType: 'application/json', required: true },
  { name: 'depth.tar', contentType: 'application/x-tar', required: false },
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
    // durable な Documents 配下に録画 (= app-kill 後の Pipeline 1 再開のため。 ultraWide と同方針)。
    const dirUri = `${FileSystem.documentDirectory}recordings/rec-${Date.now()}/`;
    const dir = await startArkitRecording(dirUri.replace(/^file:\/\//, ''));
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

  subscribeHandTrack(listener: (e: HandTrackEvent) => void): HandTrackSubscription {
    return subscribeArkitHandTrack(listener);
  },

  captureSnapshot(): Promise<string> {
    return captureArkitSnapshot();
  },

  setDisplayOrientation(orientation: DisplayOrientation): Promise<void> {
    return setArkitDisplayOrientation(orientation);
  },
};
