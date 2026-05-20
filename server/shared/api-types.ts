// クライアント <-> サーバ間の API 型。
// この file は client (= app/src/services/) と同じ shape を維持する必要がある。
// 将来的には npm workspaces で shared package 化する想定。

// クリップ状態 (= SPECS_JA §2.7)
export type ClipState = "uploading" | "processing" | "ready" | "staked" | "error";

// 処理ステップ (= SPECS_JA §6.2 Pipeline 2 の進行表示)。
export type ProcessingStep =
  | "c2pa-verify"         // 端末 C2PA 署名 (= 段階 2 のみ) を事前検証
  | "anonymize"           // ぼかし MP4 生成 + サーバ C2PA 署名 (= 「署名 S」、 段階 1)
  | "quality-eval"        // 品質スコア算出
  | "tp-submit";          // TitleClient.register で Root NFT 発行

export interface ClipDto {
  id: string;
  taskId: string;
  state: ClipState;
  createdAt: string; // ISO8601
  achievementConfidence: number | null;
  processingStep: ProcessingStep | null;
  qualityScore: number | null;
  qualityBreakdown: {
    anyHandRatio: number;
    twoHandRatio: number;
    depthValidRatio: number | null;
    syncRatio: number;
    frameGapCount: number;
  } | null;
  rootAssetId: string | null;
  delegate: string | null;
  licenseCount: number;
  revenueUsdc: number;
  errorMessage: string | null;
  /// 撮影者が Stake シートで再生する preview MP4 の 事前署名 GET URL。
  /// ready 状態以降で値が入る。 失敗 / 未生成時は null。
  previewVideoUrl: string | null;
}

// ─── API リクエスト / レスポンス ─────────────────────────────────────

/// POST /api/clips
/// 撮影者「送る」 押下時に呼ぶ。 サーバはクリップ行を作って Pipeline 1 出力 4 ファイル分の
/// presigned PUT URL を返す。
export interface CreateClipRequest {
  taskId: string;
  achievementConfidence: number;
  /// 端末で計算済の rgb.mp4 の sha256 (hex)。 重複アップロード検知に使う。
  contentHash: string;
  /// rgb.mp4 のサイズ (bytes)
  contentSize: number;
}

/// Pipeline 1 が並走出力する 4 ファイル分の presigned PUT URL。
/// 端末はこれを使って 4 並列 PUT を行う。
export type RawSessionFilename =
  | "rgb.mp4"
  | "sensors.jsonl"
  | "imu_high_rate.jsonl"
  | "camera_intrinsics.json";
export interface RawSessionUploadResponse {
  files: Record<RawSessionFilename, { url: string; key: string; contentType: string }>;
  expiresAt: string; // ISO8601
}

export interface CreateClipResponse {
  clip: ClipDto;
  upload: RawSessionUploadResponse;
}

/// POST /api/clips/:id/finalize
/// 撮影者の端末が R2 への PUT を完了したら呼ぶ。 サーバはこれを受けて workflow をキック。
export interface FinalizeUploadRequest {
  /// アップロード後の MCAP の sha256 (= 端末再計算、 サーバ受信値と照合)
  contentHash: string;
}
export interface FinalizeUploadResponse {
  clip: ClipDto;
}

/// GET /api/clips
/// 撮影者の全クリップを返す。 wallet pubkey は header から取る (= 認証時に乗せる)。
export interface ListClipsResponse {
  clips: ClipDto[];
}

/// POST /api/clips/:id/stake
/// ステーキング画面の最終承認後に呼ぶ。
/// 本実装ではここで Bubblegum delegate 命令の tx を build + 部分署名して返し、 端末が
/// wallet 署名してネットワーク送信する。 MVP では server-side で完結する mock。
export interface StakeRequest {
  /// 撮影者の wallet 署名 (= 二段階確認の証拠を tx 内に焼く + binding 検証)
  walletSignature?: string;
}
export interface StakeResponse {
  clip: ClipDto;
}

/// DELETE /api/clips/:id
/// 撮影者がクリップを破棄する。 ready 以下は server 側でも削除、 staked は不可。
export interface DeleteClipResponse {
  ok: true;
}
