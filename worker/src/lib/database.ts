// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Database Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * 証明データをデータベースに保存（最小限設計）
 *
 * 設計思想: すべての証明データはArweaveに保存。
 * Supabaseはビジネスロジック専用（価格、タイトル、状態管理のみ）
 *
 * original_hashの保存理由:
 * - manifest.jsonパス導出: media/{original_hash}/manifest.json
 * - 重複チェック・検索に使用
 */
export async function saveToDatabase(data: {
  arweaveTxId: string;
  cnftMintAddress: string;
  ownerWallet: string;
  originalHash: string;
  fileExtension: string;
  priceLamports: number;
  title?: string;
  description?: string;
}): Promise<void> {
  const { error } = await supabase.from('media_proofs').insert({
    arweave_tx_id: data.arweaveTxId,
    cnft_mint_address: data.cnftMintAddress,
    owner_wallet: data.ownerWallet,
    original_hash: data.originalHash,
    file_extension: data.fileExtension,
    price_lamports: data.priceLamports,
    title: data.title,
    description: data.description,
    is_burned: false,
    is_deleted: false,
  });

  if (error) {
    throw new Error(`Database save failed: ${error.message}`);
  }

  console.log('   Successfully saved to database');
}
