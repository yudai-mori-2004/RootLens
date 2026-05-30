// クライアント (= iOS アプリ) と サーバ で共有する API 型定義。
// 将来的に npm workspaces で shared package 化する想定。 現状は同形を維持する file コピー前提。

// ─── クリップ状態機械 (= DATA_SPECS §6) ──────────────────────────
export type ClipState = "uploading" | "processing" | "ready" | "staked" | "error";

// ─── Pipeline 2 の進行ステップ (= DATA_SPECS §3) ────────────────
// Title Protocol register はサーバ flow に載らず、 端末が R2 アップロード後に
// 並列で /process Gateway を直接叩く構造。 サーバ flow は 3 層スコアリング + 自動ラベリング。
// 2026-05-27 方針転換: gtsam-eval は撤去 (= GTSAM 層廃止)。
export type ProcessingStep =
  | "scoring";            // Pipeline 2 (= 前処理ラベリング + 多軸採点) 実行中

// ─── Solana ネットワーク (= cNFT 発行先クラスタ) ──────────────────
export type SolanaNetwork = "devnet" | "mainnet";

// ─── 撮影構成 (= DATA_SPECS §2.2) ────────────────────────────────
export type RecordingConfig = "ultra_wide" | "arkit";

// ─── 品質ベクトル (= DATA_SPECS §3、 多軸・合計なし) ──────────────────
// 2026-05-29 方針転換: 単一合成スコア (旧 layer1+2+3=100) を廃止。 品質は独立した軸ごとに
// 0-100 で出し、 合算しない (= 異種の品質軸を混ぜない / 重み付けは買い手が用途に応じて行う)。
// 軸は Pipeline 2 の採点ステージが返す (= video_technical / motion_content / label_quality、 拡張可)。

/// 1 品質軸の採点結果。 score は 0-100。 method は breakdown からの導出式 (= 監査・再計算用)。
/// breakdown はスコアの根拠 (= 独立サブ信号 + 生カウント + 閾値)。 買い手はこれで再計算・再重み付けできる。
export interface QualityAxis {
  axis: string;
  score: number;                          // 0-100
  method: string;
  breakdown: Record<string, unknown>;
}

/// 品質ベクトル (= 軸名 → AxisScore)。 合計は持たない (= 売り手が重みを焼き込まない)。
export interface QualityVector {
  axes: Record<string, QualityAxis>;
}

// ─── ClipDto ─────────────────────────────────────────────────────

export interface ClipDto {
  id: string;
  state: ClipState;
  createdAt: string; // ISO 8601
  /// 現在 Pipeline 2 のどのステップにいるか (= processing 状態時のみ非 null)
  processingStep: ProcessingStep | null;

  // ── 撮影ファクト (= 端末申告 / サーバ算出) ──
  /// 採用された撮影構成 (= 'ultra_wide' | 'arkit')。
  recordingConfig: RecordingConfig;
  /// 録画尺 (ms)。 Pipeline 2 の labeling が算出 (= ready 以降)。 端末申告があれば登録時から入る。
  durationMs: number | null;
  /// ぼかし済 rgb.mp4 のバイト数。
  contentSize: number | null;
  /// 撮影端末の機種 (= "iPhone15,2" 等)。
  deviceModel: string | null;

  // ── Pipeline 2 結果 ──
  /// 品質ベクトル (= 軸ごと 0-100 + 根拠 breakdown)。 ready 以降で値が入る。 合計は持たない。
  qualityVector: QualityVector | null;
  /// クリップの 1 行要約 (= labeling の Gemini 全体パス)。 ready 以降で入る。 可読ラベル。
  summary: string | null;

  // ── オンチェーン / 来歴 ──
  /// Title Protocol が発行した Root NFT の cNFT asset ID (= base58、 ready 以降で入る)
  rootAssetId: string | null;
  /// TP /process が返した signed_json への R2 URI (= signed-json/<signature_hash>.json)。
  /// 端末の mint 前冪等チェックで再利用するため公開する。
  signedJsonUri: string | null;
  /// cNFT を発行した Solana ネットワーク (= "devnet" | "mainnet")。
  network: SolanaNetwork;
  /// Bubblegum delegate (= staked 状態時のみ非 null)
  delegate: string | null;

  // ── 収益 ──
  /// ライセンス販売累計 (= staked 後に更新)
  licenseCount: number;
  /// 累積収益 USDC
  revenueUsdc: number;

  /// 処理エラー時のメッセージ (= error 状態時のみ非 null)
  errorMessage: string | null;
  /// 撮影者プレビュー用の R2 GET URL (= 署名済 rgb.mp4 への 1 時間 presigned URL)
  /// ready 以降で値が入る。 失敗 / 未生成時は null
  previewVideoUrl: string | null;
}

// ─── API リクエスト / レスポンス ─────────────────────────────────────

/// POST /api/clips
/// 端末で R2 upload + TP /process + cNFT 発行が完了した直後に呼ぶ。
/// rootAssetId が確定済の状態でのみクリップ行が作成される (= Pipeline 2 の前提条件)。
export interface CreateClipRequest {
  /// 端末で確定した signature_hash (= C2PA D2 アクティブマニフェスト署名の SHA-256 hex)
  /// DATA_SPECS §1.1 参照。 重複アップロード検知 + 冪等キーに使う
  signatureHash: string;
  /// rgb.mp4 のサイズ (bytes)
  contentSize: number;
  /// cNFT 発行で確定した Root NFT の cNFT asset ID (= base58)。 必須。
  /// Pipeline 1 末尾の `POST /extension/solana` + Solana broadcast で確定。
  rootAssetId: string;
  /// TP `/process` 応答を保存した R2 オブジェクト URL (= signed-json/<signature_hash>.json)。 必須。
  signedJsonUri: string;
  /// cNFT を発行した Solana ネットワーク (= 重複排除キーの一部)。 省略時は server が devnet 扱い (legacy)。
  network?: SolanaNetwork;
  /// 採用された撮影構成 (= 'ultra_wide' | 'arkit')。 省略時は server が ultra_wide 扱い (= 旧 client 互換、 移行用)。
  recordingConfig?: RecordingConfig;
  /// 録画尺 (ms)。 端末が record stop−start から算出。 省略時はサーバが Pipeline 2 で算出して埋める。
  durationMs?: number;
  /// 撮影端末の機種 (= "iPhone15,2" 等、 metadata.json と同じ utsname machine)。
  deviceModel?: string;
}

/// 撮影構成が並走出力するファイル分の presigned PUT URL (DATA_SPECS §2.2)。
/// 超広角構成は rgb/realtime_handpose/metadata の 3 つ、 ARKit 構成はそれに imu.jsonl を加える。
/// (server は全ファイル分を presign し、 端末はその構成で実際に生成したものだけ PUT する)
export type RawSessionFilename =
  | "rgb.mp4"
  | "realtime_handpose.jsonl"
  | "metadata.json"
  | "imu.jsonl"
  | "depth.tar";

export interface RawSessionUploadResponse {
  files: Record<RawSessionFilename, { url: string; key: string; contentType: string }>;
  expiresAt: string; // ISO 8601
}

export interface CreateClipResponse {
  clip: ClipDto;
  upload: RawSessionUploadResponse;
}

/// POST /api/clips/:id/finalize
/// 端末が R2 PUT 完了後に呼ぶ。 サーバはこれを受けて Pipeline 2 の WDK workflow をキック。
export interface FinalizeUploadRequest {
  /// 端末再計算の signature_hash。 サーバ受信値と照合 (= 不一致なら 409)
  signatureHash: string;
}

export interface FinalizeUploadResponse {
  clip: ClipDto;
}

/// GET /api/clips
/// 撮影者の全クリップを返す。 wallet pubkey は X-Wallet-Pubkey header で渡す
export interface ListClipsResponse {
  clips: ClipDto[];
}

/// POST /api/clips/:id/stake
/// ステーキング画面の最終承認後に呼ぶ。
/// 本実装は Bubblegum delegate 命令を build + 部分署名して返し、 端末が wallet 署名して送信する。
/// MVP では server-side で完結する mock。
export interface StakeRequest {
  /// 撮影者の wallet 署名 (= 二段階確認の証拠を tx 内に焼く)
  walletSignature?: string;
}

export interface StakeResponse {
  clip: ClipDto;
}

/// DELETE /api/clips/:id
/// 撮影者がクリップを破棄する。 ready 以前は server 側でも削除、 staked は 409。
export interface DeleteClipResponse {
  ok: true;
}

/// POST /api/clips/:id/retry
/// state == "error" のクリップを再処理する。 R2 上の raw ファイルがそのまま残ってる前提。
export interface RetryResponse {
  clip: ClipDto;
}
