// dataflow 層の正規型定義 (= Layer 1 の Source of Truth)。
//
// v0.1.4: 「カメラ計測 + raw アップロード入口」。 後段処理 (= 加工 / 採点 / 販売) はサーバ側の
// 別ワーカーとして将来配線する予定で、 この層はアップロードまでしか知らない。
//
// ⚠ このファイルは Layer 1 (dataflow)。react / react-native を import してはならない。

// ─── クリップ状態機械 (DATA_SPECS §4) ──────────────────────────────────

export type ClipState =
  | 'recorded'    // 撮影完了、 端末ローカルに保存済み (= まだアップロードしていない。 一覧に並ぶ)
  | 'uploading'   // ユーザーがアップロードを押した → 署名 → R2 PUT → POST /api/clips 進行中
  | 'uploaded'    // R2 アップ + サーバ登録 完了 (= 一覧から消える)
  | 'error';      // 段のどこかで失敗 (= 一覧に残り「もう一度試す」可能)

/**
 * Pipeline 1 (= 端末側) のチェックポイント段。 advanceClip がここを見て前進する。
 *
 *   pending     生 MP4 のみ、 content_hash 未計算。 retry → hash 計算から
 *   hashed      content_hash 確定 (= 生 mp4 の SHA-256、 アップロード対象は生 mp4 そのもの)。 retry → アップロードから
 *   registered  R2 PUT + POST /api/clips 済み (= state='uploaded')
 *
 * ⚠ content_hash は 'hashed' で初めて確定する。 それ以前の clip は local id のみで持つ。
 */
export type Pipeline1Stage = 'pending' | 'hashed' | 'registered';

// ─── クリップ ─────────────────────────────────────────────────────────

export interface Clip {
  /** 内部 ID。 撮影時に local id で生まれ、 sign 完了で signature_hash に re-key する。 */
  id: string;
  state: ClipState;
  /** 端末で撮影完了した時刻 (ms epoch) */
  createdAt: number;

  /** 採用された撮影構成の ID (= 'ultra_wide' | 'arkit' | ...) */
  recordingConfigId?: string;
  /** 撮影セッション dir (file:// URI)。 Pipeline 1 の入力ファイル群が並ぶ。 */
  sessionDir?: string;

  /** Pipeline 1 のチェックポイント段。 */
  stage?: Pipeline1Stage;

  /** 生 MP4 の SHA-256 hex (64 文字)。 hash 段完了で確定。 R2 キー / DB PK として使う。 */
  contentHash?: string;
  /** 生 MP4 (= raw/<content_hash>/rgb.mp4) のバイト数 */
  contentSize?: number;

  /** 録画尺 (ms)。 端末が record stop−start で申告。 */
  durationMs?: number | null;
  /** 撮影端末の機種 (= "iPhone15,2" 等)。 */
  deviceModel?: string | null;

  /** state === 'error' のときのエラー内容 */
  errorMessage?: string | null;

  // ─── クライアント側の進行表示 ──────────────────────────────────────
  /** Pipeline 1 のアップロード進捗 (0..1)。 state === 'uploading' のみ意味を持つ。 */
  uploadProgress?: number;
}

// ─── step 入出力 ────────────────────────────────────────────────────────
// 各 step は (input, sink) → Promise<output> の純粋関数。

/** hash step: 生 MP4 → SHA-256 (= content_hash)。 C2PA 署名は v0.1.4 で廃止。 */
export interface HashInput {
  /** 撮影 native が出力した生 MP4 (file:// URI) */
  rawMp4Uri: string;
}
export interface HashResult {
  /** SHA-256 hex 64 文字 (raw mp4 bytes) */
  contentHash: string;
  /** raw MP4 バイト数 */
  contentSize: number;
}

/** upload step: content_hash の presigned URL を取得し、 ファイル群を R2 に並列 PUT。 */
export interface UploadInput {
  contentHash: string;
  /** 撮影構成 ID。 サーバ側でアップロード先バケット + ファイルマニフェストが決まる (DATA_SPECS §3)。 */
  recordingConfig: string;
  /** R2 ファイル名 → ローカル file:// URI のマップ (= 撮影構成の outputFiles に対応) */
  files: Record<string, string>;
}
export interface UploadResult {
  /** R2 に PUT したオブジェクト key 一覧 */
  uploadedKeys: string[];
}

/** register step: POST /api/clips でサーバに登録する (= v0.1.4 では finalize 無し)。 */
export interface RegisterInput {
  contentHash: string;
  contentSize: number;
  /** クリップ所有者のアカウント公開鍵 (= Ed25519 base58)。 */
  accountPubkey: string;
  /** 撮影構成 (= 'ultra_wide' | 'arkit')。 */
  recordingConfig: string;
  /** 録画尺 (ms)。 取れなければ省略。 */
  durationMs?: number | null;
  /** 撮影端末の機種 (= utsname machine)。 */
  deviceModel?: string | null;
}
export interface RegisterResult {
  /** server 発番の clip ID */
  clipId: string;
}

/** GET /api/clips/:id で受け取るサーバ側クリップ状態 (= ClipDto のサブセット)。 */
export interface ServerClipStatus {
  id: string;
  state: ClipState;
  /** 行作成時刻 (= ISO 8601、 撮影日時)。 list 取得時に使う。 */
  createdAt?: string;
  contentHash?: string;
  durationMs?: number | null;
  recordingConfig?: string | null;
  deviceModel?: string | null;
  contentSize?: number | null;
  errorMessage?: string | null;
}
