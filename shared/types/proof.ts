// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Proof Data Type Definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Arweaveに保存するメタデータ構造（最小限設計）
 */
export interface ArweaveProofMetadata {
  name: string;            // "RootLens Proof #abc123ef"
  symbol: string;          // "RLENS"
  description: string;     // "Media authenticity proof verified by RootLens"
  target_asset_id: string; // 予測したcNFTアドレス
  attributes: ProofAttribute[];
}

/**
 * 証明データの属性
 */
export interface ProofAttribute {
  trait_type: string;
  value: string;
}

/**
 * cNFTメタデータ構造（最小限）
 */
export interface CNFTMetadata {
  name: string;
  symbol: string;
  uri: string;  // Arweave URI
}

/**
 * データベースの media_proofs テーブル構造
 *
 * 設計思想: すべての証明データはArweaveに保存。
 * Supabaseはビジネスロジック専用（価格、タイトル、状態管理のみ）
 *
 * 取得方法:
 * - root_signer: Arweaveから取得
 * - manifest_file_path: original_hashから導出（media/{original_hash}/manifest.json）
 * - license_type: manifest.jsonから取得
 * - file_format, file_size: manifest.jsonから取得
 */
export interface MediaProof {
  id: string;

  // Arweave連携（証明データの参照元）
  arweave_tx_id: string;

  // cNFT連携（所有権管理）
  cnft_mint_address: string;
  owner_wallet: string;

  // R2パス導出用（最小限のキャッシュ）
  original_hash: string;      // パス導出用: media/{hash}/...
  file_extension: string;     // 'jpg', 'png', 'mp4' 等

  // RootLens独自データ（ビジネスロジック）
  price_lamports: number;
  title?: string;
  description?: string;

  // 状態管理
  is_burned: boolean;
  is_deleted: boolean;

  // タイムスタンプ
  created_at: string;
  updated_at: string;
}

/**
 * 相互リンク検証結果
 */
export interface CrossLinkVerificationResult {
  isValid: boolean;
  arweaveData?: ArweaveProofMetadata;
  cnftData?: CNFTMetadata;
  errorMessage?: string;
}
