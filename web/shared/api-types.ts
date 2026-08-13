// 撮影端末アプリとサーバで共有するAPI型定義。
// 認証は Authorization: Bearer <supabase JWT>。

// ─── 撮影構成 ───────────────────────────────────────────────────
export type RecordingConfig = "ultra_wide" | "arkit" | "mentra";

// ─── ClipDto ─────────────────────────────────────────────────────
// サーバの clip 行はアップロード完了後にしか作られないので、 状態機械は持たない
// (サーバ行はアップロード完了後にしか無いので state を持たない。 端末側のローカル state とは別物)。

export interface ClipDto {
  /// 識別子 (= raw mp4 の SHA-256 hex。 DB PK / R2 raw キーと同値)
  contentHash: string;
  createdAt: string; // ISO 8601

  // ── 撮影ファクト (= 端末申告) ──
  recordingConfig: RecordingConfig;
  durationMs: number | null;
  contentSize: number | null;
  deviceModel: string | null;

  /// このクリップのアップロード同意イベント id (= consent_events.id)
  consentEventId: string | null;
}

// ─── API リクエスト / レスポンス ─────────────────────────────────────

/// POST /api/clips
/// 端末で content_hash 計算 + R2 アップロードを終えてから呼ぶ。
/// 重複排除キーは (account, contentHash)、 既存行があれば idempotent に返す。
export interface CreateClipRequest {
  /// 端末で計算した content_hash (= raw mp4 バイト列の SHA-256 hex)
  contentHash: string;
  /// rgb.mp4 (= raw、 blur 無し) のサイズ (bytes)
  contentSize: number;
  /// 採用された撮影構成 (= 'ultra_wide' | 'arkit' | 'mentra')
  recordingConfig: RecordingConfig;
  /// 録画尺 (ms)。 端末が record stop−start から算出。
  durationMs?: number;
  /// 撮影端末の機種 (= "iPhone15,2"、 "Mentra Live" 等)。
  deviceModel?: string;
  /// アップロード同意イベント id (= POST /api/v1/consents の返り値)。
  consentEventId?: string;
}

/// POST /api/v1/raw-uploads
/// 撮影構成が並走出力するファイル分の presigned PUT URL。 構成でバケット + ファイル集合が決まる:
///   ultra_wide → rootlens-raw        (rgb.mp4 / realtime_handpose.jsonl / metadata.json)
///   arkit      → rootlens-raw-arkit  (+ imu.jsonl / depth.tar)
///   mentra     → rootlens-raw-mentra (rgb / per-frame timestamps / imu)
export type RawSessionFilename =
  | "rgb.mp4"
  | "frames.jsonl"
  | "realtime_handpose.jsonl"
  | "metadata.json"
  | "imu.jsonl"
  | "depth.tar";

export interface RawUploadsRequest {
  contentHash: string;
  recordingConfig: RecordingConfig;
}

export interface RawSessionUploadResponse {
  files: Partial<Record<RawSessionFilename, { url: string; key: string; contentType: string }>>;
  /// presign したバケット名 (= デバッグ表示用)。
  bucket: string;
  expiresAt: string; // ISO 8601
}

export interface CreateClipResponse {
  clip: ClipDto;
}

/// GET /api/clips
/// 撮影アカウントの全クリップを返す。 アカウントは Bearer token の sub で決まる。
export interface ListClipsResponse {
  clips: ClipDto[];
}

/// PATCH /api/clips/:contentHash
/// Mentra が先にアップロードしたクリップへ、 iPhone で取得した同意イベントを結び付ける。
export interface AttachClipConsentRequest {
  consentEventId: string;
}

export interface AttachClipConsentResponse {
  clip: ClipDto;
}

/// DELETE /api/clips/:contentHash
/// 撮影者がクリップを破棄する (= 行削除のみ。 R2 オブジェクトは残置)。
export interface DeleteClipResponse {
  ok: true;
}
