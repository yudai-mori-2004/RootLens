// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Job Type Definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Mintジョブのデータ構造（最小限設計）
 */
export interface MintJobData {
  // ユーザー情報
  userWallet: string;

  // ハッシュ値（C2PA検証済み）
  originalHash: string;  // 元メディアファイルのSHA-256

  // C2PA情報（最小限）
  rootSigner: string;       // Root CA名（例: "Sony Corporation"）
  rootCertChain: string;    // Base64エンコードされた証明書チェーン

  // R2パス（アップロード済み）
  mediaFilePath: string;     // media/{originalHash}/original.{ext}

  // RootLens独自データ
  price: number;          // lamports単位（0 = 無料）
  title?: string;
  description?: string;
}

/**
 * Mintジョブの結果
 */
export interface MintJobResult {
  success: boolean;
  arweaveTxId?: string;       // Arweave トランザクションID
  cnftMintAddress?: string;   // cNFT Asset ID
  error?: string;
}

/**
 * ジョブステータス（BullMQの状態に対応）
 */
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

/**
 * ジョブステータス確認APIのレスポンス
 */
export interface JobStatusResponse {
  jobId: string;
  state: JobStatus;
  progress?: number;
  result?: MintJobResult;
  failedReason?: string;
  createdAt?: number;
  processedAt?: number;
  finishedAt?: number;
}
