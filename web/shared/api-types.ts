// クライアント (= iOS アプリ) と サーバ で共有する API 型定義。
// 将来的に npm workspaces で shared package 化する想定。 現状は同形を維持する file コピー前提。

// ─── クリップ状態機械 (= DATA_SPECS §6) ──────────────────────────
export type ClipState = "uploading" | "processing" | "ready" | "staked" | "error";

// ─── Pipeline 2 の進行ステップ (= DATA_SPECS §3) ────────────────
// Title Protocol register はサーバ flow に載らず、 端末が R2 アップロード後に
// 並列で /process Gateway を直接叩く構造。 サーバ flow は 3 層スコアリング + 自動ラベリング。
// 2026-05-27 方針転換: gtsam-eval は撤去 (= GTSAM 層廃止)。
export type ProcessingStep =
  | "metadata-scan"       // Layer 1: メタデータ解析 (= realtime_handpose.jsonl を読む)
  | "frame-sampling"      // Layer 2: フレームサンプリング画像解析
  | "vlm-score";          // Layer 3: VLM (Claude Haiku 4.5) でセマンティック採点 + 自動分類

// ─── VLM 自動分類カテゴリ (= DATA_SPECS §3.2.3) ──────────────────
export type AutoCategory =
  | "cleaning"
  | "laundry"
  | "cooking"
  | "studying"
  | "crafting"
  | "organizing"
  | "meal_prep"
  | "other";

// ─── 品質スコア内訳 (= DATA_SPECS §3.2) ──────────────────────────

/// 第 1 層: メタデータ解析 (合計 20 点)
/// 2026-05-27: ARKit 廃止に伴い tracking_state 由来の trackingQuality 指標は撤去。
/// 2026-05-28: IMU 撤去で imuGravityCompliance も撤去、 1 点を handLandmarkPresenceBoth に振替。
export interface Layer1Score {
  /// 0..20 の整数
  score: number;
  /// 両手検出フレームの割合 (= Apple Vision 手ランドマーク 21x2 が両手 ともフレーム内、 0..1)。 配点 9
  handLandmarkPresenceBoth: number;
  /// realtime_handpose.jsonl 内で有効な timestamp + frame_index を持つ行の割合 (0..1)。 配点 4
  rgbSensorSyncRatio: number;
  /// 0..N-1 のフレーム番号列における連続性 (1 = 欠番なし、 0 = 全て欠番)。 配点 4
  frameContinuity: number;
  /// 手首ランドマーク変位の分散を閾値で正規化 (0 = 完全静止、 1 = 十分な動き)。 配点 3
  handMovement: number;
  // 2026-05-28 撤去: imuGravityCompliance (= IMU 撤去、 配点 1 点は handLandmarkPresenceBoth に振替)
}

/// 第 2 層: フレームサンプリング解析 (合計 15 点)
export interface Layer2Score {
  /// 0..15 の整数
  score: number;
  /// 平均輝度が 40〜240 の範囲内のフレーム割合 (0..1)。 配点 4
  brightnessInRangeRatio: number;
  /// ラプラシアン分散が閾値以上のフレーム割合 (= シャープネス、 0..1)。 配点 4
  sharpnessPassRatio: number;
  /// Farneback 法によるフロー量が閾値以上のフレーム割合 (0..1)。 配点 4
  opticalFlowPassRatio: number;
  /// サンプルフレーム間ヒストグラム差分の平均 を 閾値で正規化 (0 = 全フレーム同一、 1 = 十分な変化)。 配点 3
  frameDiversity: number;
}

/// 第 3 層: VLM セマンティック解析 (合計 65 点)
/// 2026-05-27 方針転換: GTSAM 撤去に伴い 55 → 65 点に再配点。
/// 各基準 0..5 の平均値 (= 全サンプルフレーム平均)、 算出式は (avg/5) × 配点。
export interface Layer3Score {
  /// 0..65 の整数
  score: number;
  /// 何らかの目的的活動を遂行しているか (0=ぼーっとしている / 5=明確に手作業中)。 配点 22
  taskActivityAvg: number;
  /// 手が物体を操作しているか (0=何も触れていない / 5=道具 / 対象物を操作中)。 配点 18
  objectInteractionAvg: number;
  /// 環境が活動と合致しているか (0=不自然な状況 / 5=典型的な家事 / 作業環境)。 配点 10
  sceneMatchAvg: number;
  /// 本物の人間の手による実際の動作に見えるか (0=明らかに偽造 / 5=自然)。 配点 15
  authenticityAvg: number;
  /// task_activity == 0 のフレーム割合 (= ほぼ何もしていない時間)。 カタログフィルタ用、 score には算入しない
  idleRatio: number;
}

/// 総合スコア + 3 層内訳
/// 2026-05-27: GTSAM 層撤去で 4 層 → 3 層 (= 20 + 15 + 65 = 100)。
export interface QualityBreakdown {
  /// 0..100 (= 3 層スコアの単純合計)
  total: number;
  layer1: Layer1Score | null;
  layer2: Layer2Score | null;
  layer3: Layer3Score | null;
}

// ─── ClipDto ─────────────────────────────────────────────────────

export interface ClipDto {
  id: string;
  state: ClipState;
  createdAt: string; // ISO 8601
  /// 現在 Pipeline 2 のどのステップにいるか (= processing 状態時のみ非 null)
  processingStep: ProcessingStep | null;
  /// 0..100。 ready 以降で値が入る
  qualityScore: number | null;
  /// 3 層の内訳。 ready 以降で値が入る (= 各層の score / 各指標の値)
  qualityBreakdown: QualityBreakdown | null;
  /// VLM が事後分類した主カテゴリ (= ready 以降で入る)。
  /// 2026-05-27: 撮影前タスク選択撤去に伴い、 タスク ID は持たず Pipeline 2 で自動分類する。
  autoCategory: AutoCategory | null;
  /// autoCategory の信頼度 (= 0..1、 multi-frame 多数決の比率)
  autoCategoryConfidence: number | null;
  /// Title Protocol が発行した Root NFT の cNFT asset ID (= base58、 ready 以降で入る)
  rootAssetId: string | null;
  /// Bubblegum delegate (= staked 状態時のみ非 null)
  delegate: string | null;
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
/// 2026-05-27: 新仕様では taskId / achievementConfidence は送らない (= 事前タスク選択 + VLM gate 廃止)。
/// 段階削除中の旧 client 互換のため optional として残置、 server は受信しても fallback で吸収する。
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
  /// legacy: 旧 client が送ってきた場合のみ受信、 新 client は省略
  taskId?: string;
  achievementConfidence?: number;
}

/// 超広角構成が並走出力するファイル分の presigned PUT URL (DATA_SPECS §2.2「超広角構成」)。
/// ARKit 構成など他構成が増えたら、 その構成固有ファイル (= imu.jsonl 等) をここに足す。
export type RawSessionFilename =
  | "rgb.mp4"
  | "realtime_handpose.jsonl"
  | "metadata.json";

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
