// クライアント (= iOS アプリ) と サーバ で共有する API 型定義。
// v0.1.4: 「カメラ計測 + raw アップロード入口」 への簡素化版。 詳細は document/v0.1.4/DATA_SPECS_JA.md。

// ─── クリップ状態機械 (= DATA_SPECS §4) ──────────────────────────
// 3 値のみ。 v0.1.3 の processing / ready / staked は撤去 (= 後段ワーカー未配線)。
export type ClipState = "uploading" | "uploaded" | "error";

// ─── Solana ネットワーク ──────────────────
// v0.1.4 では mint しないので「記録のみ」。 v0.1.5 で後段ワーカーが mint する時の宛先として残す。
export type SolanaNetwork = "devnet" | "mainnet";

// ─── 撮影構成 (= DATA_SPECS §2.2) ────────────────────────────────
export type RecordingConfig = "ultra_wide" | "arkit";

// ─── ClipDto ─────────────────────────────────────────────────────

export interface ClipDto {
  id: string;
  state: ClipState;
  createdAt: string; // ISO 8601

  // ── 撮影ファクト (= 端末申告) ──
  recordingConfig: RecordingConfig;
  durationMs: number | null;
  contentSize: number | null;
  deviceModel: string | null;

  // ── 識別 ──
  signatureHash: string;
  network: SolanaNetwork;

  /// アップロード失敗時のメッセージ (= error 状態時のみ非 null)
  errorMessage: string | null;
}

// ─── API リクエスト / レスポンス ─────────────────────────────────────

/// POST /api/clips
/// 端末で C2PA D1 署名 + R2 アップロードを終えてから呼ぶ。
/// 重複排除キーは (wallet, signatureHash, network)、 既存行があれば idempotent に返す。
export interface CreateClipRequest {
  /// 端末で確定した signature_hash (= C2PA D1 アクティブマニフェスト署名の SHA-256 hex)
  signatureHash: string;
  /// rgb.mp4 (= D1 署名済、 blur 無し) のサイズ (bytes)
  contentSize: number;
  /// 採用された撮影構成 (= 'ultra_wide' | 'arkit')
  recordingConfig: RecordingConfig;
  /// Solana ネットワーク (= 重複排除キーの一部)。 省略時は server が devnet 扱い。
  network?: SolanaNetwork;
  /// 録画尺 (ms)。 端末が record stop−start から算出。
  durationMs?: number;
  /// 撮影端末の機種 (= "iPhone15,2" 等)。
  deviceModel?: string;
}

/// POST /api/v1/raw-uploads (DATA_SPECS §2.4)
/// 撮影構成が並走出力するファイル分の presigned PUT URL。 構成でバケット + ファイル集合が決まる:
///   ultra_wide → rootlens-raw        (rgb.mp4 / realtime_handpose.jsonl / metadata.json)
///   arkit      → rootlens-raw-arkit  (+ imu.jsonl / depth.tar)
export type RawSessionFilename =
  | "rgb.mp4"
  | "realtime_handpose.jsonl"
  | "metadata.json"
  | "imu.jsonl"
  | "depth.tar";

export interface RawUploadsRequest {
  signatureHash: string;
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
/// 撮影者の全クリップを返す。 wallet pubkey は X-Wallet-Pubkey header で渡す。
export interface ListClipsResponse {
  clips: ClipDto[];
}

/// DELETE /api/clips/:id
/// 撮影者がクリップを破棄する (= ローカル削除のみ。 R2 オブジェクトは残置)。
export interface DeleteClipResponse {
  ok: true;
}
