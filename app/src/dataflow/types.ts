// dataflow 層の正規型定義 (= Layer 1 の Source of Truth)。
//
// クリップの状態機械 (DATA_SPECS §6) と各 step の入出力をここに集約する。
// 既存 services/clipPipeline.ts にも同等の型があるが、 あちらは React store と密結合した
// 旧実装。 Phase C で clipPipeline 側をここから re-export に寄せて一本化する想定。
//
// ⚠ このファイルは Layer 1 (dataflow)。react / react-native を import してはならない。

// ─── クリップ状態機械 (DATA_SPECS §6) ──────────────────────────────────

export type ClipState =
  | 'uploading'   // Pipeline 1 実行中 (= rootAssetId 確定前)
  | 'processing'  // Pipeline 2 実行中
  | 'ready'       // Pipeline 2 正常完了
  | 'staked'      // delegate 設定済み
  | 'error';      // アップロード / 処理が再試行上限超過

/** Pipeline 2 の処理ステップ。 server shared/api-types.ts の ProcessingStep と一致させる。 */
export type ProcessingStep =
  | 'metadata-scan'   // 第 1 層: メタデータ解析
  | 'frame-sampling'  // 第 2 層: フレームサンプリング画像解析
  | 'vlm-score';      // 第 3 層: VLM セマンティック採点 + 自動分類

/** VLM が事後分類する活動カテゴリ (DATA_SPECS §3.2.3 の 8 値)。 */
export type AutoCategory =
  | 'cleaning' | 'laundry' | 'cooking' | 'studying'
  | 'crafting' | 'organizing' | 'meal_prep' | 'other';

// ─── 品質スコア (DATA_SPECS §3.2.4) ─────────────────────────────────────
// 配点は server 仕様に追従する。 数値の責務は server 側にあり、 ここは受信 DTO の形のみ定義。

export interface Layer1Score {
  score: number;                       // 0..20
  handLandmarkPresenceBoth: number;    // 0..1
  rgbSensorSyncRatio: number;          // 0..1
  frameContinuity: number;             // 0..1
  handMovement: number;                // 0..1
}

export interface Layer2Score {
  score: number;                       // 0..15
  brightnessInRangeRatio: number;      // 0..1
  sharpnessPassRatio: number;          // 0..1
  opticalFlowPassRatio: number;        // 0..1
  frameDiversity: number;              // 0..1
}

export interface Layer3Score {
  score: number;                       // 0..65
  taskActivityAvg: number;             // 0..5
  objectInteractionAvg: number;        // 0..5
  sceneMatchAvg: number;               // 0..5
  authenticityAvg: number;             // 0..5
  idleRatio: number;                   // 0..1 (= score 非算入の補助指標)
}

export interface QualityBreakdown {
  total: number;                       // 0..100 (= 3 層合計)
  layer1: Layer1Score | null;
  layer2: Layer2Score | null;
  layer3: Layer3Score | null;
}

// ─── クリップ ─────────────────────────────────────────────────────────

export interface Clip {
  /** 内部ローカル ID。 POST /api/clips 後は server 発番 ID に置き換わる。 */
  id: string;
  state: ClipState;
  /** 端末で撮影完了した時刻 (ms epoch) */
  createdAt: number;

  /** 採用された撮影構成の ID (= 'ultra_wide' | 'arkit' | ...) */
  recordingConfigId?: string;
  /** 撮影セッション dir (file:// URI)。 Pipeline 1 の入力ファイル群が並ぶ。 */
  sessionDir?: string;

  /** D2 (= ぼかし + 署名済) MP4 の active manifest 署名 SHA-256 hex (64 文字)。全 pipeline 不変キー。 */
  signatureHash?: string;
  /** D2 MP4 のバイト数 */
  contentSize?: number;
  /** ぼかしで検出した顔数 (累積) */
  facesBlurred?: number;

  /** TP 登録完了後に確定する Solana cNFT asset id (base58)。 Pipeline 2 起動条件。 */
  rootAssetId?: string;
  /** TP /process 応答を保存した R2 オフチェーン URL */
  signedJsonUri?: string;
  /** cNFT mint tx signature */
  txSignature?: string;

  /** Pipeline 2 処理中のステップ */
  processingStep?: ProcessingStep | null;
  /** 総合品質スコア (0..100)。 ready 以降で値が入る。 */
  qualityScore?: number | null;
  qualityBreakdown?: QualityBreakdown | null;
  autoCategory?: AutoCategory | null;
  autoCategoryConfidence?: number | null;

  /** delegate (= owner と異なれば staked) */
  delegate?: string | null;

  /** state === 'error' のときのエラー内容 */
  errorMessage?: string | null;
}

// ─── step 入出力 ────────────────────────────────────────────────────────
// 各 step は (input, sink) → Promise<output> の純粋関数。

/** sign step: 生 MP4 → D1 署名 → 顔ぼかし → D2 署名 → signature_hash 抽出。 */
export interface SignInput {
  /** 撮影 native が出力した生 MP4 (file:// URI) */
  rawMp4Uri: string;
}
export interface SignResult {
  /** ぼかし + D2 署名済 MP4 (= R2 に rgb.mp4 として上げる本体) */
  signedMp4Uri: string;
  /** SHA-256 hex 64 文字 (= "sha256:" prefix なし) */
  signatureHash: string;
  /** D2 MP4 バイト数 */
  contentSize: number;
  facesBlurred: number;
}

/** upload step: signature_hash の presigned URL を取得し、 ファイル群を R2 に並列 PUT。 */
export interface UploadInput {
  signatureHash: string;
  /** R2 ファイル名 → ローカル file:// URI のマップ (= 撮影構成の outputFiles に対応) */
  files: Record<string, string>;
}
export interface UploadResult {
  /** R2 に PUT したオブジェクト key 一覧 */
  uploadedKeys: string[];
}

/** title-protocol step: TP /process → signed-json 保存 → cNFT mint → rootAssetId 確定。 */
export interface TpInput {
  signatureHash: string;
  /** Bubblegum cNFT 発行先 merkle tree pubkey */
  merkleTree: string;
  /** MPL Core collection (= public tree なら省略可) */
  collection?: string;
}
export interface TpResult {
  rootAssetId: string;
  signedJsonUri: string;
  /** TP が返した signature_hash (= signature_hash と一致するはず) */
  signatureHash: string;
  txSignature: string;
  /** mint の payer に使った wallet pubkey (base58) */
  walletPubkey: string;
}

/** register step: POST /api/clips → POST /api/clips/:id/finalize (= Pipeline 2 起動)。 */
export interface RegisterInput {
  signatureHash: string;
  contentSize: number;
  rootAssetId: string;
  signedJsonUri: string;
  walletPubkey: string;
}
export interface RegisterResult {
  /** server 発番の clip ID */
  clipId: string;
}

/** Pipeline 2 / 3 の polling で受け取るサーバ側クリップ状態。 */
export interface ServerClipStatus {
  id: string;
  state: ClipState;
  processingStep?: ProcessingStep | null;
  qualityScore?: number | null;
  qualityBreakdown?: QualityBreakdown | null;
  autoCategory?: AutoCategory | null;
  autoCategoryConfidence?: number | null;
  rootAssetId?: string | null;
  delegate?: string | null;
  errorMessage?: string | null;
}
