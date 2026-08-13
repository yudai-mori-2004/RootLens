// The ARKit recording config (iOS).
//
// ARKit world tracking on the rear wide (1x) camera, capturing RGB video, 6DoF
// camera poses, IMU, and LiDAR depth (on Pro devices) on a shared clock. The
// native side lives in the arkit-capture module.
//
// ⚠ Dataflow layer: must not import react / react-native. The native wrapper
//   (../../native/arkitCapture) uses react-native internally, but only its
//   function exports are imported here (never the React preview component).

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

// Files the ARKit config writes into the session dir:
//   rgb.mp4                    wide (1x) RGB video
//   frames.jsonl    per-frame hand landmarks + camera pose (4×4) + tracking state + IMU snapshot
//   imu.jsonl                  accelerometer / gyro / device motion (at the configured rate; 100 Hz default)
//   metadata.json              delivered-file manifest, device/OS/app, camera/stream settings and measured stream ranges
//   depth.tar                  LiDAR depth (Pro devices only): one 16-bit PNG (millimeters) per frame,
//                              stream-appended into a single tar, plus per-frame confidence maps.
//                              Non-LiDAR devices produce none, hence required:false ("upload when present").
//   pointcloud.jsonl           ARKit raw feature points (when enabled)
//   mesh.jsonl                 ARKit scene mesh (LiDAR + when enabled)
//   arkit_imu.jsonl            one VIO-derived orientation/rotation row per ARFrame
//   device_metrics.jsonl       battery/thermal/CPU/memory samples on the ARFrame timeline
const OUTPUT_FILES: OutputFileSpec[] = [
  { name: 'rgb.mp4', contentType: 'video/mp4', required: true, isPrimaryVideo: true },
  { name: 'frames.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'imu.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'metadata.json', contentType: 'application/json', required: true },
  { name: 'depth.tar', contentType: 'application/x-tar', required: false },
  { name: 'pointcloud.jsonl', contentType: 'application/x-ndjson', required: false },
  { name: 'mesh.jsonl', contentType: 'application/x-ndjson', required: false },
  { name: 'arkit_imu.jsonl', contentType: 'application/x-ndjson', required: false },
  { name: 'device_metrics.jsonl', contentType: 'application/x-ndjson', required: false },
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
    // Record under durable Documents so the upload can resume after an app kill.
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
