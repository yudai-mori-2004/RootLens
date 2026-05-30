// 超広角構成 (DATA_SPECS §2.2「超広角構成」)。iOS / Android 共通。
//
// 背面 ultra-wide camera (0.5x) を AVCaptureSession (iOS) / Camera2 (Android) で使う。
// native は wide-capture module。 session dir 配下に下記ファイルを並走出力する。
//
// ⚠ Layer 1 (dataflow)。 react / react-native を import しない。
//    native module wrapper (../../native/wideCapture) は内部で react-native を使うが、
//    ここが import するのは関数 export のみ (= React component は触らない)。

import * as FileSystem from 'expo-file-system';

import {
  isWideCaptureAvailable,
  startWideSession,
  stopWideSession,
  startWideRecording,
  stopWideRecording,
  captureWideSnapshot,
  setWideDisplayOrientation,
  subscribeWideHandTrack,
} from '../../native/wideCapture';
import type { EventSink } from '../events';
import type {
  DisplayOrientation,
  HandTrackEvent,
  HandTrackSubscription,
  OutputFileSpec,
  RecordingConfig,
  RecordingSession,
} from './types';

// 超広角構成の出力ファイル (DATA_SPECS §2.2):
//   rgb.mp4                    超広角 RGB 映像 (30 fps)
//   realtime_handpose.jsonl    Apple Vision / MediaPipe の軽量リアルタイム手ランドマーク
//                              (= Pipeline 2 の手検出率スコアリング用の一時データ。 学習用ポーズは Pipeline 3 の WiLoR)
//   metadata.json              機種名 / OS / アプリ版 / 画角 / 構成 ID / キャリブレーション baseline 等の静的情報 (セッション 1 回)
const OUTPUT_FILES: OutputFileSpec[] = [
  { name: 'rgb.mp4', contentType: 'video/mp4', required: true, isPrimaryVideo: true },
  { name: 'realtime_handpose.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'metadata.json', contentType: 'application/json', required: true },
];

function ensureTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

export const ultraWideConfig: RecordingConfig = {
  id: 'ultra_wide',
  label: '超広角 (Ultra Wide 0.5x)',
  platform: 'both',
  outputFiles: OUTPUT_FILES,

  async isAvailable() {
    return isWideCaptureAvailable();
  },

  async startSession(sink: EventSink) {
    sink({ step: 'record', level: 'info', message: 'ultra-wide session を開始' });
    await startWideSession();
    sink({ step: 'record', level: 'success', message: 'session 開始完了 (プレビュー稼働)' });
  },

  async stopSession(sink: EventSink) {
    sink({ step: 'record', level: 'info', message: 'ultra-wide session を停止' });
    await stopWideSession();
    sink({ step: 'record', level: 'success', message: 'session 停止完了' });
  },

  async startRecording(sink: EventSink): Promise<RecordingSession> {
    sink({ step: 'record', level: 'info', message: '録画開始' });
    // app-kill 後も Pipeline 1 を再開できるよう durable な Documents 配下に録画する
    // (= tmp/ は OS が purge し得るので、 blur 中に kill されると再署名の元データも失う)。
    // native は plain path を要求するので file:// を剥がして渡す (= 返値は file:// URI)。
    const dirUri = `${FileSystem.documentDirectory}recordings/rec-${Date.now()}/`;
    const dir = await startWideRecording(dirUri.replace(/^file:\/\//, ''));
    const sessionDir = ensureTrailingSlash(dir);
    sink({ step: 'record', level: 'success', message: '録画開始完了', detail: { sessionDir } });
    return { sessionDir };
  },

  async stopRecording(sink: EventSink): Promise<RecordingSession> {
    sink({ step: 'record', level: 'info', message: '録画停止' });
    const dir = await stopWideRecording();
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
    if (!primary) throw new Error('ultra_wide config has no primary video file');
    return `${ensureTrailingSlash(session.sessionDir)}${primary.name}`;
  },

  subscribeHandTrack(listener: (e: HandTrackEvent) => void): HandTrackSubscription {
    return subscribeWideHandTrack(listener);
  },

  captureSnapshot(): Promise<string> {
    return captureWideSnapshot();
  },

  setDisplayOrientation(orientation: DisplayOrientation): Promise<void> {
    return setWideDisplayOrientation(orientation);
  },
};
