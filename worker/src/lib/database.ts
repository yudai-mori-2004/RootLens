// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RootLens Ver4 - Database Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  // workerはNext.jsではないため、SUPABASE_URLを明示的に参照
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('❌ Missing Supabase configuration');
    console.error('   SUPABASE_URL:', url ? 'Set' : 'Unset');
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', key ? 'Set' : 'Unset');
    throw new Error('Supabase configuration is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Railway.');
  }

  supabaseInstance = createClient(url, key);
  return supabaseInstance;
}

/**
 * 既存の証明データが存在するかチェック
 *
 * @returns 既存データが存在する場合は true
 */
export async function checkExistingProof(originalHash: string): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('media_proofs')
    .select('id, cnft_mint_address')
    .eq('original_hash', originalHash)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('⚠️ Error checking existing proof:', error);
    return false; // エラー時は続行を許可
  }

  if (data) {
    console.log(`   Found existing proof: ${data.cnft_mint_address}`);
    return true;
  }

  return false;
}

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
}): Promise<{ id: string }> {
  const supabase = getSupabase();
  const { data: upsertedData, error } = await supabase
    .from('media_proofs')
    .upsert({
      original_hash: data.originalHash, // Conflict target
      arweave_tx_id: data.arweaveTxId,
      cnft_mint_address: data.cnftMintAddress,
      owner_wallet: data.ownerWallet,
      file_extension: data.fileExtension,
      price_lamports: data.priceLamports,
      title: data.title,
      description: data.description,
      is_public: true,
    }, { onConflict: 'original_hash' })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Database save failed: ${error.message}`);
  }

  console.log('   Successfully saved to database (upsert)');
  return { id: upsertedData.id };
}
