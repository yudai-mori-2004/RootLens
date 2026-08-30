// iPhone RGB + IMU capture without ARKit.
//
// The native backend uses AVCaptureSession with the rear ultra-wide camera and
// Core Motion. Its delivered manifest deliberately matches Mentra: rgb.mp4,
// frames.jsonl, imu.jsonl, and metadata.json. The JSON schemas preserve raw
// timestamps and carry the measured video-to-IMU residual separately.

import * as FileSystem from 'expo-file-system';

import {
  captureIphoneSnapshot,
  isIphoneCaptureAvailable,
  setIphoneDisplayOrientation,
  startIphoneRecording,
  startIphoneSession,
  stopIphoneRecording,
  stopIphoneSession,
  subscribeIphoneHandTrack,
} from '../../native/iphoneCapture';
import type { EventSink } from '../events';
import type {
  DisplayOrientation,
  HandTrackEvent,
  HandTrackSubscription,
  OutputFileSpec,
  RecordingConfig,
  RecordingSession,
} from './types';

const OUTPUT_FILES: OutputFileSpec[] = [
  { name: 'rgb.mp4', contentType: 'video/mp4', required: true, isPrimaryVideo: true },
  { name: 'frames.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'imu.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'metadata.json', contentType: 'application/json', required: true },
];

function ensureTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

export const iphoneConfig: RecordingConfig = {
  id: 'iphone',
  label: 'iPhone (ultra-wide + IMU)',
  platform: 'ios',
  outputFiles: OUTPUT_FILES,

  isAvailable: isIphoneCaptureAvailable,

  async startSession(sink: EventSink) {
    sink({ step: 'record', level: 'info', message: 'iPhone RGB + IMU session を開始' });
    await startIphoneSession();
    sink({ step: 'record', level: 'success', message: 'session 開始完了 (プレビュー稼働)' });
  },

  async stopSession(sink: EventSink) {
    sink({ step: 'record', level: 'info', message: 'iPhone RGB + IMU session を停止' });
    await stopIphoneSession();
    sink({ step: 'record', level: 'success', message: 'session 停止完了' });
  },

  async startRecording(sink: EventSink): Promise<RecordingSession> {
    sink({ step: 'record', level: 'info', message: '録画開始 (iPhone RGB + IMU)' });
    const dirUri = `${FileSystem.documentDirectory}recordings/rec-${Date.now()}/`;
    const dir = await startIphoneRecording(dirUri.replace(/^file:\/\//, ''));
    const sessionDir = ensureTrailingSlash(dir);
    sink({ step: 'record', level: 'success', message: '録画開始完了', detail: { sessionDir } });
    return { sessionDir };
  },

  async stopRecording(sink: EventSink): Promise<RecordingSession> {
    sink({ step: 'record', level: 'info', message: '録画停止 (iPhone RGB + IMU)' });
    const dir = await stopIphoneRecording();
    const sessionDir = ensureTrailingSlash(dir);
    sink({
      step: 'record',
      level: 'success',
      message: '録画停止完了',
      detail: { sessionDir, files: OUTPUT_FILES.map((file) => file.name) },
    });
    return { sessionDir };
  },

  primaryVideoUri(session: RecordingSession): string {
    return `${ensureTrailingSlash(session.sessionDir)}rgb.mp4`;
  },

  async attachContentIdentity(session, identity, sink) {
    const metadataUri = `${ensureTrailingSlash(session.sessionDir)}metadata.json`;
    const metadata = JSON.parse(await FileSystem.readAsStringAsync(metadataUri)) as Record<string, unknown>;
    if (metadata.recording_config !== 'iphone') {
      throw new Error('iPhone metadata recording_config mismatch');
    }
    metadata.content_hash = identity.contentHash;
    metadata.video_bytes = identity.contentSize;
    await FileSystem.writeAsStringAsync(metadataUri, JSON.stringify(metadata, null, 2));
    sink({
      step: 'hash',
      level: 'success',
      message: 'metadata に content_hash を反映',
      detail: { contentHash: identity.contentHash },
    });
  },

  subscribeHandTrack(listener: (event: HandTrackEvent) => void): HandTrackSubscription {
    return subscribeIphoneHandTrack(listener);
  },

  captureSnapshot: captureIphoneSnapshot,

  setDisplayOrientation(orientation: DisplayOrientation): Promise<void> {
    return setIphoneDisplayOrientation(orientation);
  },
};
