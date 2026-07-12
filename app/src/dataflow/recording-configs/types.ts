// 撮影構成 (recording config) の抽象インターフェース (DATA_SPECS §2.2)。
//
// 撮影は「プラットフォームごとに複数定義できる抽象レイヤー」として設計する。
// 各構成は利用可能な出力ファイルのリストを宣言し、 session lifecycle と録画制御を提供する。
// Pipeline 1 の後段 (sign / upload / tp / register) は構成を意識しない:
// 「session dir に何のファイルが並ぶか」 は構成の outputFiles が一元的に決める。
//
// 現状の実装:
//   - arkit (iOS 限定)  ← arkit-capture native module
// 将来はスマートグラス構成等をここに足す。
//
// ⚠ このファイルは Layer 1 (dataflow)。react / react-native を import してはならない。

import type { EventSink } from '../events';

// ─── リアルタイム手検出 (= 撮影構成が提供する、 ジェスチャー層が乗る土台) ───────────
// ジェスチャー / キャリブレーション UX は「撮影構成の上に薄く乗るソース」 であり、 構成ごとの
// native 差異を意識しない。 そのため手検出イベントの subscribe を構成抽象が提供し、
// UX 層は config.subscribeHandTrack() だけを見る (= 構成非依存)。
// 型は native (arkitCapture) の onHandTrack payload と同形。

export interface HandLandmark {
  x: number;        // 0..1 (左上原点)
  y: number;        // 0..1
  confidence: number;
}

export type GestureKind = 'open_palm' | 'thumbs_up';

export interface WearerHandObservation {
  handedness: 'left' | 'right' | 'unknown';
  confidence: number;
  landmarks: HandLandmark[];   // 必ず 21 要素 (MediaPipe 順)
  /** この手単体のジェスチャー判定 (= native の per-hand 幾何判定。 検出不能は null)。
   *  両手の合議 (= フレーム gesture の集約) は TS 側 (= 撮影画面) が per-hand から行う。 */
  gesture: GestureKind | null;
}

/** 1 フレームの手の状態。 native onHandTrack の payload と同形。
 *  frame-level gesture は廃止 (= per-hand gesture を TS で集約する方針へ移行)。 */
export interface HandTrackEvent {
  timestampNs: string;
  imageWidth: number;
  imageHeight: number;
  wearerHandCount: number;          // 0 / 1 / 2
  wearerHands: WearerHandObservation[];
  /// 互換フィールド (= 2026-05-27 hand framing 判定撤去で wide では 0.0)。
  segmentationCoverage: number;
  segmentationEdgeRatio: number;
}

/** 表示 orientation (= native が frame を回す向き)。 撮影は横持ち固定なので portrait は廃止。 */
export type DisplayOrientation = 'landscapeLeft' | 'landscapeRight';

/** 手検出 subscribe のハンドル。 */
export interface HandTrackSubscription {
  remove(): void;
}

/** 撮影構成が session dir に出力する 1 ファイルの宣言。 */
export interface OutputFileSpec {
  /** session dir 内のファイル名 (= R2 raw/<content_hash>/ 配下にも同名で並ぶ) */
  name: string;
  /** アップロード時の Content-Type */
  contentType: string;
  /**
   * true = 必須 (= 欠けたら fail-loud)、 false = 任意 (= 存在すれば使い、 なければスキップ)。
   * DATA_SPECS §3.2「撮影構成固有のデータがある場合は、 存在すれば使い、 なければスキップする」。
   */
  required: boolean;
  /** この MP4 が blur / 手渡し MCAP の対象本体か (= 撮影構成につき 1 つ) */
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
  /** 一意識別子 (= Clip.recordingConfigId に保存)。 'arkit' | ... */
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

  // ─── リアルタイム操作面 (= ジェスチャー UX が乗る土台。 構成非依存) ──────────────
  /** リアルタイム手検出イベントを購読する (= ~15-30 Hz)。 */
  subscribeHandTrack(listener: (e: HandTrackEvent) => void): HandTrackSubscription;
  /** 最新フレームを JPEG として temp に書き出し file:// URI を返す (= 次タスク提案用)。 */
  captureSnapshot(): Promise<string>;
  /** native に表示 orientation を伝える (= 録画開始前に確定させる)。 */
  setDisplayOrientation(orientation: DisplayOrientation): Promise<void>;
}
