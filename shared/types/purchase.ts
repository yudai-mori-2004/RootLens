// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Purchase Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 購入リクエスト
 */
export interface PurchaseRequest {
  mediaProofId: string;        // 購入対象のmedia_proof_id
  buyerWallet: string;          // 購入者ウォレットアドレス
  buyerEmail: string;           // 購入者メールアドレス
  txSignature: string;          // SolanaトランザクションシグネチャURL
}

/**
 * 購入レスポンス
 */
export interface PurchaseResponse {
  success: boolean;
  purchaseId?: string;          // purchases.id
  downloadToken?: string;       // ダウンロードトークン
  error?: string;
}

/**
 * ダウンロードトークン検証結果
 */
export interface DownloadTokenData {
  valid: boolean;
  mediaProofId?: string;
  originalHash?: string;
  fileExtension?: string;
  buyerEmail?: string;
  expiresAt?: string;
  downloadCount?: number;
  error?: string;
}
