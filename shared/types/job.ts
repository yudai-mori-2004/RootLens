// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - BullMQ Job Type Definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Mintジョブのデータ構造（最小限設計）
 */
export interface MintJobData {
  userWallet: string;
  originalHash: string;
  rootSigner: string;
  rootCertChain: string;
  mediaFilePath: string;
  thumbnailPublicUrl?: string;
  price: number;
  title?: string;
  description?: string;
  mediaProofId?: string;
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
