// ARKit 構成 (DATA_SPECS §2.2「ARKit 構成」)。iOS 限定。
//
// ARKit world tracking + 背面 wide camera (1x)。6DoF カメラポーズ・IMU・LiDAR 深度 (Pro 端末のみ) を
// 同期取得する。超広角構成より画角が狭く発熱が大きい。
//
// native module は未実装 (= 2026-05-27 に旧 arkit-capture を撤去済み)。この構成は
// 撮影構成の抽象がプラットフォームごとに複数パスを持てることを表現するための実体であり、
// native が用意されるまで isAvailable() は false を返し、 lifecycle 呼び出しは fail-loud にする。
//
// ⚠ Layer 1 (dataflow)。react / react-native を import しない。

import type { EventSink } from '../events';
import type { OutputFileSpec, RecordingConfig, RecordingSession } from './types';

// ARKit 構成の出力ファイル (DATA_SPECS §2.2):
//   rgb.mp4                    wide (1x) RGB 映像 (30 fps)
//   realtime_handpose.jsonl    手ランドマーク + カメラポーズ (4x4) + tracking_state
//                              (= 超広角構成と同じファイル名。 行スキーマに構成固有フィールドが増えるだけ)
//   imu.jsonl                  加速度 / ジャイロ / デバイスモーション (100 Hz)
//   metadata.json              機種名 / OS / アプリ版 / 画角 / 構成 ID / キャリブレーション baseline 等の静的情報
//   depth/<frame>.png          LiDAR 深度 (Pro 端末のみ、 可変枚数)。 単一ファイルではないので outputFiles には含めず別扱い。
const OUTPUT_FILES: OutputFileSpec[] = [
  { name: 'rgb.mp4', contentType: 'video/mp4', required: true, isPrimaryVideo: true },
  { name: 'realtime_handpose.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'imu.jsonl', contentType: 'application/x-ndjson', required: true },
  { name: 'metadata.json', contentType: 'application/json', required: true },
];

const NOT_IMPLEMENTED =
  'ARKit 構成の native module は未実装です (= 別フェーズで再導入)。現状この構成は選択できません。';

export const arkitConfig: RecordingConfig = {
  id: 'arkit',
  label: 'ARKit (wide 1x + 6DoF + LiDAR)',
  platform: 'ios',
  outputFiles: OUTPUT_FILES,

  async isAvailable() {
    // native 未実装のため常に false。 native 導入時にここを ARKit module の可用性判定に差し替える。
    return false;
  },

  async startSession(_sink: EventSink) {
    throw new Error(NOT_IMPLEMENTED);
  },
  async stopSession(_sink: EventSink) {
    throw new Error(NOT_IMPLEMENTED);
  },
  async startRecording(_sink: EventSink): Promise<RecordingSession> {
    throw new Error(NOT_IMPLEMENTED);
  },
  async stopRecording(_sink: EventSink): Promise<RecordingSession> {
    throw new Error(NOT_IMPLEMENTED);
  },

  primaryVideoUri(session: RecordingSession): string {
    const primary = OUTPUT_FILES.find((f) => f.isPrimaryVideo);
    if (!primary) throw new Error('arkit config has no primary video file');
    const dir = session.sessionDir.endsWith('/') ? session.sessionDir : `${session.sessionDir}/`;
    return `${dir}${primary.name}`;
  },
};
