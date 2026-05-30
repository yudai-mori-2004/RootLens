// dataflow 層の正規型定義 (= Layer 1 の Source of Truth)。
//
// クリップの状態機械 (DATA_SPECS §6) と各 step の入出力をここに集約する。
// クリップ型はここが単一の真実 (= 旧 services/clipPipeline.ts は task 18 で廃止済み)。
//
// ⚠ このファイルは Layer 1 (dataflow)。react / react-native を import してはならない。

// ─── クリップ状態機械 (DATA_SPECS §6) ──────────────────────────────────

export type ClipState =
  | 'uploading'   // Pipeline 1 実行中 (= rootAssetId 確定前)
  | 'processing'  // Pipeline 2 実行中
  | 'ready'       // Pipeline 2 正常完了
  | 'staked'      // delegate 設定済み
  | 'error';      // アップロード / 処理が再試行上限超過

/**
 * Pipeline 1 (= 端末側) のチェックポイント段 (= 再開可能リトライの再開点)。
 * クリップは撮影時に 'unsigned' で生まれ、 各段の成果物をローカルに残しながら前進する。
 * 失敗した段から、 成功済みの中間成果物を再利用して再開する (= advanceClip)。
 *
 *   unsigned        生 MP4 のみ (= 未署名)。 retry → D1 署名から
 *   capture-signed  D1 署名済み (= 撮影署名済み、 d1.mp4 あり)。 retry → ぼかし+D2 から
 *   blur-signed     ぼかし + D2 署名済み (= signature_hash 誕生、 署名済 rgb.mp4 あり)。 retry → アップロードから
 *   registered      R2 + TP/mint + POST /api/clips + finalize 済み (= Pipeline 2 起動済み)。 端末 retry は無し
 *
 * ⚠ signature_hash は 'blur-signed' で初めて確定する。 それ以前 (unsigned / capture-signed) の
 *    クリップは local id でローカルにのみ存在し、 サーバには出ない (= blur 前は別の動画)。
 */
export type Pipeline1Stage = 'unsigned' | 'capture-signed' | 'blur-signed' | 'registered';

/** Pipeline 2 の処理ステップ。 server shared/api-types.ts の ProcessingStep と一致させる。 */
export type ProcessingStep =
  | 'metadata-scan'   // 第 1 層: メタデータ解析
  | 'frame-sampling'  // 第 2 層: フレームサンプリング画像解析
  | 'vlm-score';      // 第 3 層: VLM セマンティック採点 + 自動分類

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

// 多軸品質ベクトル (= DATA_SPECS §3、 合計なし)。 サーバの ClipDto.qualityVector と同形。
// 軸ごと 0-100 + 根拠 breakdown。 旧 QualityBreakdown (= layer1/2/3 合算) を置き換える正式形。
export interface QualityAxis {
  axis: string;
  score: number;                       // 0-100
  method: string;
  breakdown: Record<string, unknown>;
}
export interface QualityVector {
  axes: Record<string, QualityAxis>;
}

/** 想定報酬レンジ (USDC)。 現状サーバ未提供で常に未設定 (= 表示は予約枠)。 */
export interface ClipReward {
  rangeUsdcLow: number;
  rangeUsdcHigh: number;
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

  /** Pipeline 1 のチェックポイント段 (= 再開可能リトライの再開点)。 */
  stage?: Pipeline1Stage;
  /** 署名中間成果物 (d1.mp4 / 署名済 rgb.mp4) を置くローカル作業 dir (file:// URI、 末尾 /)。
   *  段が通るまで保持し、 retry で再利用する。 登録済みになったら片付ける。 */
  workDir?: string;

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
  /** 総合品質スコア (0..100)。 ⚠ サーバは合成スコアを持たない (= 常に未設定)。 quality は qualityVector が正。 */
  qualityScore?: number | null;
  /** ⚠ 旧 layered 形 (= サーバ未提供で常に未設定)。 品質表示の正は qualityVector (= 軸ベクトル)。 */
  qualityBreakdown?: QualityBreakdown | null;
  /** 多軸品質ベクトル (= DATA_SPECS §3、 ready 以降)。 サーバ ClipDto.qualityVector。 */
  qualityVector?: QualityVector | null;
  /** クリップの 1 行要約 (= Gemini 全体パス、 ready 以降)。 可読ラベル。 */
  summary?: string | null;

  /** 録画尺 (ms)。 端末が record stop−start で申告 / サーバが Pipeline 2 で算出。 */
  durationMs?: number | null;
  /** 撮影端末の機種 (= "iPhone15,2" 等)。 */
  deviceModel?: string | null;

  /** delegate (= owner と異なれば staked) */
  delegate?: string | null;

  /** state === 'error' のときのエラー内容 */
  errorMessage?: string | null;

  // ─── クライアント側の進行表示 ──────────────────────────────────────
  /** Pipeline 1 のアップロード進捗 (0..1)。 state === 'uploading' のみ意味を持つ。 */
  uploadProgress?: number;

  // ─── サーバ同期の表示フィールド (= ClipDto 由来。 ready / staked 以降で入る) ──
  /** サーバ生成の ぼかし済 preview MP4 への presigned GET URL (= ClipDto.previewVideoUrl)。 */
  previewVideoUrl?: string;
  /** ライセンス販売累計 (= ClipDto.licenseCount + on-chain hydrate)。 */
  licenseCount?: number;
  /** 累積収益 USDC (= ClipDto.revenueUsdc + on-chain hydrate)。 */
  revenueUsdc?: number;

  // ─── legacy / 表示互換 ────────────────────────────────────────────
  // 新フローでは設定しない。 旧 persistence からの hydrate / 既存 UI 互換のためだけに optional で残す。
  /** 想定報酬レンジ (= 現状サーバ未提供、 常に undefined)。 */
  reward?: ClipReward;
  /** 撮影時 snapshot の URI 群 (= 現状新フローでは未設定)。 */
  previewUris?: string[];
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
  /** 撮影構成 (= 'ultra_wide' | 'arkit')。 */
  recordingConfig: string;
  /** 録画尺 (ms)。 撮影画面の stop−start。 取れなければ省略 (= サーバが算出)。 */
  durationMs?: number | null;
  /** 撮影端末の機種 (= utsname machine)。 */
  deviceModel?: string | null;
}
export interface RegisterResult {
  /** server 発番の clip ID */
  clipId: string;
}

/** Pipeline 2 / 3 の polling で受け取るサーバ側クリップ状態 (= ClipDto のサブセット)。 */
export interface ServerClipStatus {
  id: string;
  state: ClipState;
  processingStep?: ProcessingStep | null;
  /** 多軸品質ベクトル (= ready 以降)。 合成スコア (qualityScore) は持たない。 */
  qualityVector?: QualityVector | null;
  /** クリップの 1 行要約 (= ready 以降)。 */
  summary?: string | null;
  /** 録画尺 (ms)。 */
  durationMs?: number | null;
  /** 撮影構成 / 機種 / サイズ (= 撮影ファクト)。 */
  recordingConfig?: string | null;
  deviceModel?: string | null;
  contentSize?: number | null;
  rootAssetId?: string | null;
  delegate?: string | null;
  errorMessage?: string | null;
  /** サーバ生成 preview MP4 の presigned GET URL (= ready 以降)。 */
  previewVideoUrl?: string | null;
  /** ライセンス販売累計 (= staked 後に更新)。 */
  licenseCount?: number | null;
  /** 累積収益 USDC。 */
  revenueUsdc?: number | null;
}
