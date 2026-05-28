// 撮影構成 (recording config) の抽象インターフェース (DATA_SPECS §2.2)。
//
// 撮影は「プラットフォームごとに複数定義できる抽象レイヤー」として設計する。
// 各構成は利用可能な出力ファイルのリストを宣言し、 session lifecycle と録画制御を提供する。
// Pipeline 1 の後段 (sign / upload / tp / register) は構成を意識しない:
// 「session dir に何のファイルが並ぶか」 は構成の outputFiles が一元的に決める。
//
// 現状の実装:
//   - ultra_wide (iOS / Android 共通)  ← wide-capture native module
// 将来:
//   - arkit (iOS 限定)                 ← ARKit native module (v0.1.4 で再導入)
//   - android_mediapipe 等
//
// ⚠ このファイルは Layer 1 (dataflow)。react / react-native を import してはならない。

import type { EventSink } from '../events';

/** 撮影構成が session dir に出力する 1 ファイルの宣言。 */
export interface OutputFileSpec {
  /** session dir 内のファイル名 (= R2 raw/<signature_hash>/ 配下にも同名で並ぶ) */
  name: string;
  /** アップロード時の Content-Type */
  contentType: string;
  /**
   * true = 必須 (= 欠けたら fail-loud)、 false = 任意 (= 存在すれば使い、 なければスキップ)。
   * DATA_SPECS §3.2「撮影構成固有のデータがある場合は、 存在すれば使い、 なければスキップする」。
   */
  required: boolean;
  /** この MP4 が C2PA 署名 + 顔ぼかしの対象本体か (= 撮影構成につき 1 つ) */
  isPrimaryVideo?: boolean;
}

/** 録画セッションのハンドル。 */
export interface RecordingSession {
  /** 出力ファイルが並ぶディレクトリの file:// URI */
  sessionDir: string;
}

/**
 * 撮影構成の抽象。 native module の差異 (AVCaptureSession / ARKit / Camera2) をここで吸収する。
 * UI はこの interface だけを見て録画を駆動でき、 native の詳細を知らない。
 */
export interface RecordingConfig {
  /** 一意識別子 (= Clip.recordingConfigId に保存)。 'ultra_wide' | 'arkit' | ... */
  readonly id: string;
  /** UI 表示名 */
  readonly label: string;
  readonly platform: 'ios' | 'android' | 'both';
  /** この構成が出力するファイル群 (= upload step がこれを参照する) */
  readonly outputFiles: OutputFileSpec[];

  /** 端末がこの構成に対応しているか。 */
  isAvailable(): Promise<boolean>;

  /** プレビュー + センサーの session を開始 (= 録画はまだしない)。 */
  startSession(sink: EventSink): Promise<void>;
  /** session を終了する。 */
  stopSession(sink: EventSink): Promise<void>;

  /** 録画開始。 返値は出力先 session dir。 */
  startRecording(sink: EventSink): Promise<RecordingSession>;
  /** 録画停止。 返値は startRecording と同じ session dir。 */
  stopRecording(sink: EventSink): Promise<RecordingSession>;

  /** session dir 内の primary video (= 署名/ぼかし対象 MP4) の file:// URI を返す。 */
  primaryVideoUri(session: RecordingSession): string;
}
